import assert from "node:assert/strict";
import { test } from "node:test";
import { arcPlaylist, plannedAdditions, PLAYLIST_RETRY_DELAYS_MS, syncSeriesPlaylist, titleFromPrefix } from "./playlist";
import { loadArcs } from "./series";

test("an arc with no title of its own is named after its prefix", () => {
  assert.equal(titleFromPrefix("scripts/camera-six"), "Camera Six");
  assert.equal(titleFromPrefix("scripts\\lost-property"), "Lost Property");
});

test("parts are appended in arc order, skipping the unpublished and the already listed", () => {
  const uploads = new Map([
    ["Part Three", "c"],
    ["Part One", "a"],
    ["Part Two", "b"],
  ]);

  assert.deepEqual(plannedAdditions(["Part One", "Part Two", "Part Three", "Part Four"], uploads, new Set()), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(plannedAdditions(["Part One", "Part Two", "Part Three"], uploads, new Set(["a", "b"])), ["c"]);
});

test("one video under two part titles is only added once", () => {
  const uploads = new Map([
    ["Same", "a"],
    ["Also Same", "a"],
  ]);

  assert.deepEqual(plannedAdditions(["Same", "Also Same"], uploads, new Set()), ["a"]);
});

type Call = { method: string; url: URL; body?: any };

async function withApi(
  respond: (call: Call) => unknown,
  run: (calls: Call[]) => Promise<void>,
) {
  const original = globalThis.fetch;
  const calls: Call[] = [];

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status: 200 });
  }) as typeof globalThis.fetch;

  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const uploadsPage = {
  items: [
    { snippet: { title: "Part Two", resourceId: { videoId: "b" } } },
    { snippet: { title: "Part One", resourceId: { videoId: "a" } } },
    { snippet: { title: "Unrelated", resourceId: { videoId: "z" } } },
  ],
};

test("a missing playlist is created public and filled from part one", async () => {
  await withApi(
    ({ method, url }) => {
      const resource = url.pathname.split("/").pop();
      if (resource === "playlists" && method === "GET") return { items: [{ id: "other", snippet: { title: "Other" } }] };
      if (resource === "playlists" && method === "POST") return { id: "new" };
      if (resource === "channels") return { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU" } } }] };
      if (resource === "playlistItems" && method === "GET") return uploadsPage;
      return {};
    },
    async (calls) => {
      const result = await syncSeriesPlaylist({
        token: "t",
        series: { title: "Camera Six", partTitles: ["Part One", "Part Two", "Part Three", "Part Four"] },
        justUploaded: { title: "Part Three", videoId: "c" },
      });

      assert.deepEqual(result, { playlistId: "new", added: 3, created: true });

      const created = calls.find((call) => call.method === "POST" && call.url.pathname.endsWith("/playlists"));
      assert.equal(created?.body.snippet.title, "Camera Six");
      assert.equal(created?.body.status.privacyStatus, "public");

      const inserted = calls
        .filter((call) => call.method === "POST" && call.url.pathname.endsWith("/playlistItems"))
        .map((call) => call.body.snippet.resourceId.videoId);
      assert.deepEqual(inserted, ["a", "b", "c"]);
    },
  );
});

test("an existing playlist only gets what it is missing", async () => {
  await withApi(
    ({ method, url }) => {
      const resource = url.pathname.split("/").pop();
      if (resource === "playlists") return { items: [{ id: "PL", snippet: { title: "Camera Six" } }] };
      if (resource === "channels") return { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU" } } }] };
      if (resource === "playlistItems" && method === "GET") {
        return url.searchParams.get("playlistId") === "PL"
          ? { items: [{ snippet: { resourceId: { videoId: "a" } } }, { snippet: { resourceId: { videoId: "b" } } }] }
          : uploadsPage;
      }
      return {};
    },
    async (calls) => {
      const result = await syncSeriesPlaylist({
        token: "t",
        series: { title: "Camera Six", partTitles: ["Part One", "Part Two", "Part Three"] },
        justUploaded: { title: "Part Three", videoId: "c" },
      });

      assert.deepEqual(result, { playlistId: "PL", added: 1, created: false });
      assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    },
  );
});

test("pages are followed to the end", async () => {
  await withApi(
    ({ method, url }) => {
      const resource = url.pathname.split("/").pop();
      if (resource === "playlists" && method === "GET") {
        return url.searchParams.get("pageToken")
          ? { items: [{ id: "PL", snippet: { title: "Camera Six" } }] }
          : { items: [], nextPageToken: "p2" };
      }
      if (resource === "channels") return { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU" } } }] };
      if (resource === "playlistItems" && method === "GET") return { items: [] };
      return {};
    },
    async () => {
      const result = await syncSeriesPlaylist({
        token: "t",
        series: { title: "Camera Six", partTitles: ["Part One"] },
        justUploaded: { title: "Part One", videoId: "a" },
      });

      assert.equal(result.created, false);
      assert.equal(result.playlistId, "PL");
    },
  );
});

test("an arc's playlist is read from its own payloads, in part order", async () => {
  const [arc] = await loadArcs(["scripts/floor-four"]);
  const series = await arcPlaylist(arc);

  assert.equal(series.title, "Please Do Not Press Four");
  assert.equal(series.partTitles.length, 5);
});

async function withStatuses(statusFor: (method: string, resource: string, attempt: number) => number, run: (inserts: () => number) => Promise<void>) {
  const original = globalThis.fetch;
  const delays = PLAYLIST_RETRY_DELAYS_MS.splice(0, Infinity, 0, 0);
  let inserts = 0;

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const resource = new URL(String(input)).pathname.split("/").pop() ?? "";
    const insert = resource === "playlistItems" && method === "POST";
    const status = insert ? statusFor(method, resource, inserts++) : 200;

    if (status !== 200) return new Response('{"error":{"status":"ABORTED"}}', { status });
    if (resource === "playlists" && method === "GET") return new Response(JSON.stringify({ items: [] }));
    if (resource === "playlists") return new Response(JSON.stringify({ id: "new" }));
    if (resource === "channels") return new Response(JSON.stringify({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU" } } }] }));
    if (resource === "playlistItems" && method === "GET") return new Response(JSON.stringify(uploadsPage));
    return new Response("{}");
  }) as typeof globalThis.fetch;

  try {
    await run(() => inserts);
  } finally {
    globalThis.fetch = original;
    PLAYLIST_RETRY_DELAYS_MS.splice(0, Infinity, ...delays);
  }
}

const twoParts = { title: "Arc", partTitles: ["Part One", "Part Two"] };

test("an aborted insert is sent again rather than failing the sync", async () => {
  await withStatuses(
    (_method, _resource, attempt) => (attempt === 1 ? 409 : 200),
    async (inserts) => {
      const { added } = await syncSeriesPlaylist({ token: "t", series: twoParts });
      assert.equal(added, 2);
      assert.equal(inserts(), 3);
    },
  );
});

test("an insert that keeps aborting gives up after the retries", async () => {
  await withStatuses(
    () => 409,
    async (inserts) => {
      await assert.rejects(() => syncSeriesPlaylist({ token: "t", series: twoParts }), /409/);
      assert.equal(inserts(), PLAYLIST_RETRY_DELAYS_MS.length + 1);
    },
  );
});

test("a refused insert is not retried", async () => {
  await withStatuses(
    () => 403,
    async (inserts) => {
      await assert.rejects(() => syncSeriesPlaylist({ token: "t", series: twoParts }));
      assert.equal(inserts(), 1);
    },
  );
});
