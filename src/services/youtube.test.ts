import test from "node:test";
import assert from "node:assert/strict";
import {
  DESCRIPTION_LIMIT,
  TAGS_LIMIT,
  TITLE_LIMIT,
  buildUploadMetadata,
  describeYouTubeError,
  resolveYouTubeConfig,
  watchUrl,
} from "./youtube";

function withEnv(values: Record<string, string | undefined>, body: () => void) {
  const saved: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const listing = { title: "I Pressed Four", description: "The panel had a fourth button.", tags: ["horror"] };

test("every missing credential is named at once, not one per attempt", () => {
  withEnv(
    { YOUTUBE_CLIENT_ID: undefined, YOUTUBE_CLIENT_SECRET: undefined, YOUTUBE_REFRESH_TOKEN: undefined },
    () => {
      assert.throws(resolveYouTubeConfig, (error: Error) => {
        assert.match(error.message, /YOUTUBE_CLIENT_ID/);
        assert.match(error.message, /YOUTUBE_CLIENT_SECRET/);
        assert.match(error.message, /YOUTUBE_REFRESH_TOKEN/);
        return true;
      });
    },
  );
});

test("a complete set of credentials resolves", () => {
  withEnv({ YOUTUBE_CLIENT_ID: "a", YOUTUBE_CLIENT_SECRET: "b", YOUTUBE_REFRESH_TOKEN: "c" }, () => {
    assert.deepEqual(resolveYouTubeConfig(), { clientId: "a", clientSecret: "b", refreshToken: "c" });
  });
});

test("the disclosure is set at insert time, not left to a second call", () => {
  assert.equal(buildUploadMetadata(listing).status.containsSyntheticMedia, true);
});

test("uploads are private and not made for kids unless told otherwise", () => {
  const { status } = buildUploadMetadata(listing);

  assert.equal(status.privacyStatus, "private");
  assert.equal(status.selfDeclaredMadeForKids, false);
});

test("an over-long title is cut at a word boundary, not mid-word", () => {
  const title = "The badge reader shows a duplicate employee number every night at exactly the same minute again";
  const { snippet } = buildUploadMetadata({ ...listing, title: `${title} and again and again and again` });

  assert.ok(snippet.title.length <= TITLE_LIMIT);
  assert.ok(!snippet.title.endsWith(" "));
  assert.equal(snippet.title, snippet.title.trimEnd());
  assert.ok(!/\w$/.test(title.slice(snippet.title.length, snippet.title.length + 1)));
});

test("a single word longer than the whole limit is still cut to fit", () => {
  const { snippet } = buildUploadMetadata({ ...listing, title: "x".repeat(TITLE_LIMIT + 40) });

  assert.equal(snippet.title.length, TITLE_LIMIT);
});

test("a title within the limit is left exactly alone", () => {
  assert.equal(buildUploadMetadata(listing).snippet.title, "I Pressed Four");
});

test("an over-long description is brought inside the limit", () => {
  const { snippet } = buildUploadMetadata({
    ...listing,
    description: "word ".repeat(DESCRIPTION_LIMIT),
  });

  assert.ok(snippet.description.length <= DESCRIPTION_LIMIT);
});

test("tags are dropped whole rather than truncated into half a tag", () => {
  const tags = Array.from({ length: 40 }, (_, i) => `${"tag".repeat(6)}${i}`);
  const { snippet } = buildUploadMetadata({ ...listing, tags });

  assert.ok(snippet.tags.length < tags.length);
  for (const tag of snippet.tags) {
    assert.ok(tags.includes(tag));
  }
});

test("the tag budget counts the separators the API counts", () => {
  const tags = Array.from({ length: 60 }, () => "x".repeat(9));
  const { snippet } = buildUploadMetadata({ ...listing, tags });

  const combined = snippet.tags.join(",").length;

  assert.ok(combined <= TAGS_LIMIT, `combined length ${combined} exceeds ${TAGS_LIMIT}`);
});

test("tags that fit are all kept, in the order given", () => {
  assert.deepEqual(buildUploadMetadata({ ...listing, tags: ["a", "b", "c"] }).snippet.tags, ["a", "b", "c"]);
});

test("a dead refresh token says how to replace it, not just that it failed", () => {
  const error = describeYouTubeError(400, '{"error":"invalid_grant"}');

  assert.match(error.message, /youtube-authorise/);
  assert.match(error.message, /YOUTUBE_REFRESH_TOKEN/);
});

test("a thumbnail refusal points at channel verification", () => {
  const error = describeYouTubeError(403, "The authenticated user cannot set custom video thumbnails");

  assert.match(error.message, /youtube\.com\/verify/);
});

test("an upload limit is reported as nothing to fix", () => {
  assert.match(describeYouTubeError(403, '{"reason":"uploadLimitExceeded"}').message, /try tomorrow/i);
});

test("an unrecognised failure still carries the status and the body", () => {
  const error = describeYouTubeError(500, "upstream exploded");

  assert.match(error.message, /500/);
  assert.match(error.message, /upstream exploded/);
});

test("the watch url is the one a person can open", () => {
  assert.equal(watchUrl("abc123"), "https://youtube.com/watch?v=abc123");
});
