import assert from "node:assert/strict";
import { test } from "node:test";
import { plannedAdditions, syncSeriesPlaylist, titleFromPrefix } from "./playlist";

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
