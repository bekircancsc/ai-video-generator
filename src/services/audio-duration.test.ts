import assert from "node:assert/strict";
import { test } from "node:test";
import { getWavDurationSeconds, parseWavHeader } from "./audio-duration";

/**
 * Builds a minimal RIFF/WAVE buffer.
 * `extraChunk` inserts a junk chunk before `data`, which real encoders do and
 * which a parser assuming a fixed 44-byte header would get wrong.
 */
function buildWav(options: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  extraChunk?: boolean;
}) {
  const { sampleRate, channels, bitsPerSample, dataBytes, extraChunk = false } = options;

  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 16);
  fmt.writeUInt16LE((channels * bitsPerSample) / 8, 20);
  fmt.writeUInt16LE(bitsPerSample, 22);

  const extra = Buffer.alloc(12);
  extra.write("LIST", 0, "ascii");
  extra.writeUInt32LE(4, 4);
  extra.write("INFO", 8, "ascii");

  const data = Buffer.alloc(8 + dataBytes);
  data.write("data", 0, "ascii");
  data.writeUInt32LE(dataBytes, 4);

  const body = Buffer.concat(extraChunk ? [fmt, extra, data] : [fmt, data]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + body.length, 4);
  header.write("WAVE", 8, "ascii");

  return Buffer.concat([header, body]);
}

test("parses format fields from a standard header", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 48000 });
  assert.deepEqual(parseWavHeader(wav), {
    sampleRate: 24000,
    channels: 1,
    bitsPerSample: 16,
    dataBytes: 48000,
  });
});

test("measures duration of Groq's 24kHz mono 16-bit output", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 48000 });
  assert.equal(getWavDurationSeconds(wav), 1);
});

test("skips unknown chunks placed before data", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 24000, extraChunk: true });
  assert.equal(getWavDurationSeconds(wav), 0.5);
});

test("handles stereo and higher bit depth", () => {
  const wav = buildWav({ sampleRate: 48000, channels: 2, bitsPerSample: 24, dataBytes: 48000 * 2 * 3 });
  assert.equal(getWavDurationSeconds(wav), 1);
});

test("clamps a data size that overruns the buffer", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 24000 });
  // Overwrite the data chunk's declared size with a value larger than the file.
  wav.writeUInt32LE(999999, wav.length - 24000 - 4);
  assert.equal(getWavDurationSeconds(wav), 0.5);
});

test("rejects a buffer that is not RIFF/WAVE", () => {
  assert.throws(() => parseWavHeader(Buffer.from("definitely not audio")), /RIFF\/WAVE/);
});

test("rejects a WAVE file with no data chunk", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 0 });
  const truncated = wav.subarray(0, wav.length - 8);
  assert.throws(() => parseWavHeader(truncated), /data chunk/);
});
