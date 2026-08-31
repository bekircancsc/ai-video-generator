import assert from "node:assert/strict";
import { test } from "node:test";
import { clipPathFor, imageCacheKey, imagePathFor, musicCacheKey, musicPathFor, narrationCacheKey, transcriptPathFor } from "./clip-paths";

test("cache key is stable for identical input", () => {
  const first = narrationCacheKey("hello there", "daniel", "orpheus");
  const second = narrationCacheKey("hello there", "daniel", "orpheus");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
});

test("clip path sits under audio/ with a .wav extension", () => {
  assert.equal(clipPathFor("3f2a1b0c9d8e7f60"), "audio/3f2a1b0c9d8e7f60.wav");
});

test("a transcript sits beside its clip", () => {
  assert.equal(transcriptPathFor("audio/3f2a1b0c.wav", "whisper-large-v3-turbo"), "audio/3f2a1b0c.whisper-large-v3-turbo.json");
});

test("the extension match is case insensitive", () => {
  assert.equal(transcriptPathFor("audio/3f2a1b0c.WAV", "whisper-large-v3-turbo"), "audio/3f2a1b0c.whisper-large-v3-turbo.json");
});

test("a slash in the model id is sanitised out of the filename", () => {
  const result = transcriptPathFor("audio/3f2a1b0c.wav", "openai/whisper-1");
  assert.equal(result, "audio/3f2a1b0c.openai-whisper-1.json");
  assert.doesNotMatch(result.split("/").slice(1).join("/"), /\//);
});

test("two different transcription models produce two different transcript paths for the same clip", () => {
  const a = transcriptPathFor("audio/3f2a1b0c.wav", "whisper-large-v3-turbo");
  const b = transcriptPathFor("audio/3f2a1b0c.wav", "whisper-large-v3");
  assert.notEqual(a, b);
});

test("refuses a path that would collide with the audio clip", () => {
  // A clip path that doesn't end in .wav can't be turned into a distinct
  // transcript path by the .wav -> .json replacement, so this must throw
  // rather than silently return the same path (which would overwrite audio).
  assert.throws(() => transcriptPathFor("audio/3f2a1b0c.raw", "whisper-large-v3-turbo"), /same path/);
});

test("image cache key is stable and 16 hex characters", () => {
  const first = imageCacheKey("a cold bridge", "pollinations", "flux", 1080, 1920);
  const second = imageCacheKey("a cold bridge", "pollinations", "flux", 1080, 1920);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
});

test("image cache key changes with prompt, provider, model or size", () => {
  const base = imageCacheKey("a cold bridge", "pollinations", "flux", 1080, 1920);
  assert.notEqual(base, imageCacheKey("a warm bridge", "pollinations", "flux", 1080, 1920));
  assert.notEqual(base, imageCacheKey("a cold bridge", "together", "flux", 1080, 1920));
  assert.notEqual(base, imageCacheKey("a cold bridge", "pollinations", "other", 1080, 1920));
  assert.notEqual(base, imageCacheKey("a cold bridge", "pollinations", "flux", 768, 1344));
});

test("image path lives under images/ and never collides with audio", () => {
  assert.equal(imagePathFor("abc123"), "images/abc123.jpg");
  assert.notEqual(imagePathFor("abc123"), clipPathFor("abc123"));
});

test("a music key changes with the seed, the length, the fps and the version", () => {
  const base = musicCacheKey(1, 900, 30, 1);
  assert.notEqual(base, musicCacheKey(2, 900, 30, 1));
  assert.notEqual(base, musicCacheKey(1, 901, 30, 1));
  assert.notEqual(base, musicCacheKey(1, 900, 60, 1));
  assert.notEqual(base, musicCacheKey(1, 900, 30, 2));
});

test("the same music inputs give the same key", () => {
  assert.equal(musicCacheKey(1, 900, 30, 1), musicCacheKey(1, 900, 30, 1));
  assert.equal(musicCacheKey(1, 900, 30, 1).length, 16);
});

test("a music path lives under music/ and ends in .wav", () => {
  assert.equal(musicPathFor("abc123"), "music/abc123.wav");
});
