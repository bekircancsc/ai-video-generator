import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunResult } from "../services/result";
import { announcement, readRunResult } from "./publish";

async function resultFile(contents: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "publish-"));
  const file = path.join(directory, "render.json");

  await fs.writeFile(file, contents, "utf8");

  return file;
}

const success: RunResult = {
  ok: true,
  mp4: "out/i-pressed-four.mp4",
  cover: "out/i-pressed-four.jpg",
  slug: "i-pressed-four",
  title: "I Pressed Four",
  description: "The panel had a fourth button.",
  tags: ["horror"],
  durationSeconds: 44.6,
};

test("a successful render reads back whole", async () => {
  assert.deepEqual(await readRunResult(await resultFile(JSON.stringify(success))), success);
});

test("a failed render is refused with the reason the render gave", async () => {
  const file = await resultFile(JSON.stringify({ ok: false, error: "Every queued arc is spent" }));

  await assert.rejects(() => readRunResult(file), /Every queued arc is spent/);
});

test("a failed render with no reason still refuses rather than uploading nothing", async () => {
  const file = await resultFile('{"ok":false}');

  await assert.rejects(() => readRunResult(file), /nothing to publish/);
});

test("a result with no video is refused", async () => {
  const file = await resultFile(JSON.stringify({ ...success, mp4: "" }));

  await assert.rejects(() => readRunResult(file), /names no video file/);
});

test("a missing file says which file", async () => {
  await assert.rejects(() => readRunResult(path.join(os.tmpdir(), "not-here.json")), /Could not read/);
});

test("log lines mixed into the JSON are diagnosed, not parsed", async () => {
  const file = await resultFile(`Render complete: out/x.mp4\n${JSON.stringify(success)}`);

  await assert.rejects(() => readRunResult(file), /stdout and stderr were mixed/);
});

test("an unscheduled announcement asks for a review", () => {
  const text = announcement(success, "abc123");

  assert.match(text, /I Pressed Four/);
  assert.match(text, /https:\/\/youtube\.com\/watch\?v=abc123/);
  assert.match(text, /44\.6s/);
  assert.match(text, /Private/);
});

test("the announcement never interpolates an undefined id", () => {
  assert.ok(!announcement(success, "abc123").includes("undefined"));
});

test("a scheduled announcement gives the deadline in local time, not the raw timestamp", () => {
  const text = announcement(success, "abc123", "2026-09-04T18:00:00.000Z");

  // 18:00Z is 21:00 in Istanbul, and a bare Z timestamp in a phone notification
  // is a subtraction to do at the moment you least want to do one.
  assert.match(text, /21:00/);
  assert.match(text, /04 Sep/);
  assert.ok(!text.includes("18:00:00.000Z"));
  assert.match(text, /Delete it before then/);
});

test("a low queue is called out in the announcement", () => {
  const text = announcement({ ...success, queueRemaining: 2 }, "abc123", "2026-09-04T18:00:00.000Z");

  assert.match(text, /2 nights left/);
});

test("the last queued part says nothing goes out tomorrow", () => {
  const text = announcement({ ...success, queueRemaining: 0 }, "abc123");

  // The number on its own reads as fine. "0 nights left" is not a warning.
  assert.match(text, /nothing goes out tomorrow/i);
  assert.ok(!text.includes("0 nights"));
});

test("one night left is not pluralised", () => {
  assert.match(announcement({ ...success, queueRemaining: 1 }, "abc123"), /1 night left/);
  assert.ok(!announcement({ ...success, queueRemaining: 1 }, "abc123").includes("1 nights"));
});

test("a healthy queue is not mentioned at all", () => {
  const text = announcement({ ...success, queueRemaining: 9 }, "abc123");

  assert.ok(!/night/i.test(text));
  assert.ok(!/queue/i.test(text));
});

test("a run outside a series says nothing about a queue", () => {
  // A --payload or --niche run has no queue to be low.
  const text = announcement(success, "abc123");

  assert.ok(!/night/i.test(text));
  assert.ok(!/queue/i.test(text));
});
