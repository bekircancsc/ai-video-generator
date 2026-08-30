import assert from "node:assert/strict";
import { test } from "node:test";
import { narrationCacheKey } from "./voiceover";

test("cache key is stable for identical input", () => {
  const first = narrationCacheKey("hello there", "daniel", "orpheus");
  const second = narrationCacheKey("hello there", "daniel", "orpheus");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
});

test("cache key changes with narration, voice or model", () => {
  const base = narrationCacheKey("hello there", "daniel", "orpheus");
  assert.notEqual(base, narrationCacheKey("hello world", "daniel", "orpheus"));
  assert.notEqual(base, narrationCacheKey("hello there", "troy", "orpheus"));
  assert.notEqual(base, narrationCacheKey("hello there", "daniel", "other"));
});
