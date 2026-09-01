import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyArgs,
  AUDIO_BITRATE,
  measureArgs,
  parseLoudnormJson,
  TARGET_LUFS,
  TARGET_RANGE,
  TRUE_PEAK_CEILING,
} from "./loudness";

const measured = {
  input_i: "-21.80",
  input_tp: "-3.10",
  input_lra: "9.40",
  input_thresh: "-32.10",
};

const measurementJson = `{
  "input_i" : "-21.80",
  "input_tp" : "-3.10",
  "input_lra" : "9.40",
  "input_thresh" : "-32.10",
  "output_i" : "-14.00"
}`;

test("the measuring pass decodes to nowhere", () => {
  const args = measureArgs("out/clip.mp4");

  assert.ok(args.includes("-i"));
  assert.deepEqual(args.slice(-3), ["-f", "null", "-"]);
  assert.ok(args.some((arg) => arg.includes("print_format=json")));
});

test("the measuring pass names the target once", () => {
  const filter = measureArgs("out/clip.mp4").find((arg) => arg.startsWith("loudnorm="));

  assert.ok(filter);
  assert.ok(filter.includes(`I=${TARGET_LUFS}`));
  assert.ok(filter.includes(`TP=${TRUE_PEAK_CEILING}`));
  assert.ok(filter.includes(`LRA=${TARGET_RANGE}`));
});

test("the applying pass copies the picture and re-encodes only the sound", () => {
  const args = applyArgs("out/clip.mp4", "out/clip.tmp.mp4", measured);
  const codecIndex = args.indexOf("-c:v");

  assert.equal(args[codecIndex + 1], "copy");
  assert.equal(args[args.indexOf("-c:a") + 1], "aac");
  assert.equal(args[args.indexOf("-b:a") + 1], AUDIO_BITRATE);
  assert.equal(args.at(-1), "out/clip.tmp.mp4");
});

test("the applying pass feeds the measurement back in and stays linear", () => {
  const filter = applyArgs("in.mp4", "out.mp4", measured).find((arg) => arg.startsWith("loudnorm="));

  assert.ok(filter);
  assert.ok(filter.includes("measured_I=-21.80"));
  assert.ok(filter.includes("measured_TP=-3.10"));
  assert.ok(filter.includes("measured_LRA=9.40"));
  assert.ok(filter.includes("measured_thresh=-32.10"));
  assert.ok(filter.includes("linear=true"));
});

test("reads the measurement out of ffmpeg's chatter", () => {
  const stderr = `Input #0, mov,mp4\n  Stream #0:1: Audio: aac\n[Parsed_loudnorm_0 @ 0x1] \n${measurementJson}\n`;

  assert.deepEqual(parseLoudnormJson(stderr), measured);
});

test("refuses a measurement that is missing numbers", () => {
  assert.throws(() => parseLoudnormJson('{ "input_i" : "-21.80" }'), /missing fields/);
});

test("refuses output with no measurement at all", () => {
  assert.throws(() => parseLoudnormJson("Output file does not contain any stream"), /no loudness measurement/);
});
