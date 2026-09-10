import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTtsError, groqVoices, resolveTtsConfig } from "./tts";

test("explains how to accept model terms", () => {
  const error = describeTtsError(
    400,
    JSON.stringify({ error: { code: "model_terms_required", message: "requires terms acceptance" } }),
  );
  assert.match(error.message, /console\.groq\.com/);
});

test("lists the valid voices when the voice is rejected", () => {
  const error = describeTtsError(400, JSON.stringify({ error: { message: "voice must be one of the following voices" } }));
  assert.match(error.message, /daniel/);
});

test("points at the key when authentication fails", () => {
  const error = describeTtsError(401, "unauthorized");
  assert.match(error.message, /LLM_API_KEY/);
});

test("keeps the raw body for unrecognised failures", () => {
  const error = describeTtsError(500, "upstream exploded");
  assert.match(error.message, /upstream exploded/);
});

test("every documented voice is present", () => {
  assert.deepEqual([...groqVoices], ["autumn", "diana", "hannah", "austin", "daniel", "troy"]);
});

test("rejects a voice outside the supported list", () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousVoice = process.env.TTS_VOICE;
  process.env.LLM_API_KEY = "test-key";
  process.env.TTS_VOICE = "gandalf";

  try {
    assert.throws(() => resolveTtsConfig(), /gandalf/);
  } finally {
    process.env.LLM_API_KEY = previousKey;
    process.env.TTS_VOICE = previousVoice;
  }
});

test("a spent daily quota is named rather than reported as a status code", () => {
  const error = describeTtsError(
    429,
    JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Rate limit reached for model playai-tts on tokens per day (TPD)" } }),
  );

  assert.match(error.message, /quota/i);
  assert.match(error.message, /resets/i);
});

test("a quota failure does not read as something to fix", () => {
  // Nothing is misconfigured when the free tier runs out, and a message that
  // sends someone to check the key wastes the evening.
  const error = describeTtsError(429, "rate_limit_exceeded");

  assert.ok(!/LLM_API_KEY/.test(error.message));
});
