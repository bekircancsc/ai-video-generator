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

test("images are on by default and off with --no-images", () => {
  assert.equal(parseArgs(["--topic", "x"]).images, true);
  assert.equal(parseArgs(["--topic", "x", "--no-images"]).images, false);
});

test("--no-images is not swallowed into the topic", () => {
  assert.equal(parseArgs(["The", "Future", "--no-images"]).topic, "The Future");
});

test("music is on unless it is turned off", () => {
  assert.equal(parseArgs(["--topic", "Rome"]).music, true);
  assert.equal(parseArgs(["--topic", "Rome", "--no-music"]).music, false);
});

test("--no-music is not read as a topic", () => {
  assert.equal(parseArgs(["Rome", "--no-music"]).topic, "Rome");
});

test("--no-cover turns the cover off and is not read as a topic", () => {
  const args = parseArgs(["--topic", "Stoicism", "--no-cover"]);

  assert.equal(args.cover, false);
  assert.equal(args.topic, "Stoicism");
});

test("the cover is on by default", () => {
  assert.equal(parseArgs(["--topic", "Stoicism"]).cover, true);
});

test("--no-loudness turns the loudness stage off and is not read as a topic", () => {
  const args = parseArgs(["--topic", "Lifts", "--no-loudness"]);

  assert.equal(args.loudness, false);
  assert.equal(args.topic, "Lifts");
});

test("loudness is on unless it is turned off", () => {
  assert.equal(parseArgs(["--topic", "Lifts"]).loudness, true);
});

test("reads --niche-file as a path", () => {
  assert.equal(parseArgs(["--niche-file", "niches/floor-four.md"]).nicheFile, "niches/floor-four.md");
});

test("nicheFile is undefined when the flag is absent", () => {
  assert.equal(parseArgs(["--topic", "x"]).nicheFile, undefined);
});

test("--niche-file and --niche together are an error", () => {
  assert.throws(
    () => parseArgs(["--niche", "office horror", "--niche-file", "niches/floor-four.md"]),
    /--niche and --niche-file cannot be used together/,
  );
});

test("--niche-file with no value is an error", () => {
  assert.throws(() => parseArgs(["--niche-file"]), /--niche-file requires a value/);
});

test("a niche file path does not leak into the positional topic", () => {
  assert.equal(parseArgs(["--niche-file", "niches/floor-four.md"]).topic, "");
});

test("json is off by default and on with --json", () => {
  assert.equal(parseArgs(["--topic", "x"]).json, false);
  assert.equal(parseArgs(["--topic", "x", "--json"]).json, true);
});

test("--json is not swallowed into the topic", () => {
  assert.equal(parseArgs(["The", "Future", "--json"]).topic, "The Future");
});

test("reads --stage as a directory", () => {
  assert.equal(parseArgs(["--topic", "x", "--stage", "C:/n8n-data"]).stageDir, "C:/n8n-data");
});

test("stageDir is undefined when the flag is absent", () => {
  assert.equal(parseArgs(["--topic", "x"]).stageDir, undefined);
});

test("--stage with no value is an error", () => {
  assert.throws(() => parseArgs(["--topic", "x", "--stage"]), /--stage requires a value/);
});

test("a staging directory does not leak into the positional topic", () => {
  assert.equal(parseArgs(["Rome", "--stage", "C:/n8n-data"]).topic, "Rome");
});
