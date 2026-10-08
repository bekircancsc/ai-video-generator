import assert from "node:assert/strict";
import { test } from "node:test";
import { seriesArgs } from "./sync-playlists";

test("every --series value is an arc, in the order given", () => {
  assert.deepEqual(seriesArgs(["--series", "scripts/a", "--series", "scripts/b"]), ["scripts/a", "scripts/b"]);
});

test("a --series with no value is not an arc", () => {
  assert.deepEqual(seriesArgs(["--series", "--series", "scripts/b", "--series"]), ["scripts/b"]);
});
