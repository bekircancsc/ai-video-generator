import test from "node:test";
import assert from "node:assert/strict";
import { MUSIC_SAMPLE_RATE, synthesizeBed } from "./music-gen";

// Two seconds is long enough to exercise the fades and short enough to stay fast.
const SECONDS = 2;

function samples(wav: Buffer): number {
  return (wav.length - 44) / 4; // 2 channels x 16 bits
}

test("writes a RIFF/WAVE file", () => {
  const wav = synthesizeBed(12345, SECONDS);
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.subarray(12, 16).toString("ascii"), "fmt ");
  assert.equal(wav.subarray(36, 40).toString("ascii"), "data");
});

test("declares 16-bit stereo PCM at the sample rate it used", () => {
  const wav = synthesizeBed(12345, SECONDS);
  assert.equal(wav.readUInt16LE(20), 1, "format should be PCM");
  assert.equal(wav.readUInt16LE(22), 2, "should be stereo");
  assert.equal(wav.readUInt32LE(24), MUSIC_SAMPLE_RATE);
  assert.equal(wav.readUInt16LE(34), 16, "should be 16-bit");
});

test("the declared sizes match the bytes actually written", () => {
  const wav = synthesizeBed(12345, SECONDS);
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
});

test("is as long as it was asked to be", () => {
  assert.equal(samples(synthesizeBed(1, SECONDS)), MUSIC_SAMPLE_RATE * SECONDS);
});

test("the same seed gives the same bed", () => {
  assert.ok(synthesizeBed(777, SECONDS).equals(synthesizeBed(777, SECONDS)));
});

test("different seeds give different beds", () => {
  assert.ok(!synthesizeBed(777, SECONDS).equals(synthesizeBed(778, SECONDS)));
});

test("no sample clips", () => {
  const wav = synthesizeBed(4242, SECONDS);

  for (let offset = 44; offset < wav.length; offset += 2) {
    const sample = wav.readInt16LE(offset);
    assert.ok(sample > -32768 && sample < 32767, `sample ${sample} clips at byte ${offset}`);
  }
});

test("starts and ends near silence", () => {
  const wav = synthesizeBed(4242, SECONDS);
  assert.ok(Math.abs(wav.readInt16LE(44)) < 200);
  assert.ok(Math.abs(wav.readInt16LE(wav.length - 2)) < 200);
});

test("is not silent in the middle", () => {
  const wav = synthesizeBed(4242, SECONDS);
  let peak = 0;

  for (let offset = 44; offset < wav.length; offset += 2) {
    peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  }

  assert.ok(peak > 8000, `peak ${peak} is too quiet to be a bed`);
});

test("refuses a length it cannot render", () => {
  assert.throws(() => synthesizeBed(1, 0));
  assert.throws(() => synthesizeBed(1, -3));
  assert.throws(() => synthesizeBed(1, Number.NaN));
});
