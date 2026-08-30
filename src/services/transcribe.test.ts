import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTranscribeError, extractWords, resolveTranscribeConfig } from "./transcribe";

test("points at the key when authentication fails", () => {
  assert.match(describeTranscribeError(401, "unauthorized").message, /LLM_API_KEY/);
});

test("says to retry when rate limited", () => {
  assert.match(describeTranscribeError(429, "slow down").message, /rate limit/i);
});

test("keeps the raw body for unrecognised failures", () => {
  assert.match(describeTranscribeError(500, "upstream exploded").message, /upstream exploded/);
});

test("reads and trims word timings out of a verbose response", () => {
  const words = extractWords({ words: [{ word: " Hello", start: 0.1, end: 0.4 }] });
  assert.deepEqual(words, [{ word: "Hello", start: 0.1, end: 0.4 }]);
});

test("rejects a response carrying no word timings", () => {
  assert.throws(() => extractWords({ text: "Hello" }), /no word timings/);
});

test("resolves the default model", () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousModel = process.env.TRANSCRIBE_MODEL;
  process.env.LLM_API_KEY = "test-key";
  delete process.env.TRANSCRIBE_MODEL;

  try {
    assert.equal(resolveTranscribeConfig().model, "whisper-large-v3-turbo");
  } finally {
    process.env.LLM_API_KEY = previousKey;
    if (previousModel !== undefined) {
      process.env.TRANSCRIBE_MODEL = previousModel;
    }
  }
});
