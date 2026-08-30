import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCachedTranscript } from "./captions";

test("accepts a valid non-empty array of caption words", () => {
  const words = [{ word: "hello", start: 0, end: 0.3 }];
  assert.deepEqual(parseCachedTranscript(words), words);
});

test("rejects an empty array as a cache miss, not empty captions", () => {
  assert.equal(parseCachedTranscript([]), undefined);
});

test("rejects a non-array payload", () => {
  assert.equal(parseCachedTranscript({}), undefined);
  assert.equal(parseCachedTranscript("not an array"), undefined);
  assert.equal(parseCachedTranscript(null), undefined);
});

test("rejects an array containing a malformed entry", () => {
  assert.equal(parseCachedTranscript([{ foo: 1 }]), undefined);
  assert.equal(parseCachedTranscript([{ word: "hi", start: 0, end: 0.2 }, { word: "there" }]), undefined);
});
