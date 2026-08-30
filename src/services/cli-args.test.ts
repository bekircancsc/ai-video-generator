import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./cli-args";

test("reads --topic", () => {
  assert.equal(parseArgs(["--topic", "The Future of AI"]).topic, "The Future of AI");
});

test("treats a bare positional argument as the topic", () => {
  assert.equal(parseArgs(["The", "Future", "of", "AI"]).topic, "The Future of AI");
});

test("reads --payload", () => {
  assert.equal(parseArgs(["--payload", "scripts/example-payload.json"]).payloadFile, "scripts/example-payload.json");
});

test("audio is on by default and off with --no-audio", () => {
  assert.equal(parseArgs(["--topic", "x"]).audio, true);
  assert.equal(parseArgs(["--topic", "x", "--no-audio"]).audio, false);
});

test("a flag with no value is an error", () => {
  assert.throws(() => parseArgs(["--topic"]), /--topic requires a value/);
  assert.throws(() => parseArgs(["--topic", "--no-audio"]), /--topic requires a value/);
});
