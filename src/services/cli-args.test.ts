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

test("reads --niche", () => {
  assert.equal(parseArgs(["--niche", "stoic philosophy"]).niche, "stoic philosophy");
});

test("niche and topic combine", () => {
  const args = parseArgs(["--niche", "stoic philosophy", "--topic", "Amor fati"]);
  assert.equal(args.niche, "stoic philosophy");
  assert.equal(args.topic, "Amor fati");
});

test("a niche does not leak into the positional topic", () => {
  assert.equal(parseArgs(["--niche", "stoic philosophy"]).topic, "");
});

test("reads --scenes as a number", () => {
  assert.equal(parseArgs(["--topic", "x", "--scenes", "6"]).sceneCount, 6);
});

test("scene count is undefined when the flag is absent", () => {
  assert.equal(parseArgs(["--topic", "x"]).sceneCount, undefined);
});

test("--scenes rejects anything outside 3 to 8", () => {
  assert.throws(() => parseArgs(["--topic", "x", "--scenes", "2"]), /between 3 and 8/);
  assert.throws(() => parseArgs(["--topic", "x", "--scenes", "9"]), /between 3 and 8/);
});

test("--scenes rejects a non-integer", () => {
  assert.throws(() => parseArgs(["--topic", "x", "--scenes", "abc"]), /between 3 and 8/);
  assert.throws(() => parseArgs(["--topic", "x", "--scenes", "4.5"]), /between 3 and 8/);
});

test("--scenes with no value is an error", () => {
  assert.throws(() => parseArgs(["--topic", "x", "--scenes"]), /--scenes requires a value/);
});

test("a positional topic keeps a word that matches a flag value", () => {
  assert.equal(parseArgs(["5", "stoic", "habits", "--scenes", "5"]).topic, "5 stoic habits");
});
