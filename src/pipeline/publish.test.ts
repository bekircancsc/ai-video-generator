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

test("the announcement carries the title, the link and the private warning", () => {
  const text = announcement(success, "abc123");

  assert.match(text, /I Pressed Four/);
  assert.match(text, /https:\/\/youtube\.com\/watch\?v=abc123/);
  assert.match(text, /44\.6s/);
  assert.match(text, /private/);
});

test("the announcement never interpolates an undefined id", () => {
  assert.ok(!announcement(success, "abc123").includes("undefined"));
});
