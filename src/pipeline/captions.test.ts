import assert from "node:assert/strict";
import { test } from "node:test";
import { transcriptPathFor } from "./captions";

test("a transcript sits beside its clip", () => {
  assert.equal(transcriptPathFor("audio/3f2a1b0c.wav"), "audio/3f2a1b0c.json");
});

test("the extension match is case insensitive", () => {
  assert.equal(transcriptPathFor("audio/3f2a1b0c.WAV"), "audio/3f2a1b0c.json");
});
