import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { STAGED_COVER_NAME, STAGED_VIDEO_NAME, stageOutputs } from "./stage";

async function tempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("the video is copied under a fixed name", async () => {
  const source = await tempDir("src-");
  const target = await tempDir("stage-");
  const video = path.join(source, "some-long-slug.mp4");
  await fs.writeFile(video, "video bytes");

  const staged = await stageOutputs(target, { videoLocation: video });

  assert.equal(staged.mp4, path.join(target, STAGED_VIDEO_NAME));
  assert.equal(await fs.readFile(staged.mp4, "utf8"), "video bytes");
});

test("the cover is copied too when there is one", async () => {
  const source = await tempDir("src-");
  const target = await tempDir("stage-");
  const video = path.join(source, "s.mp4");
  const cover = path.join(source, "s.jpg");
  await fs.writeFile(video, "v");
  await fs.writeFile(cover, "c");

  const staged = await stageOutputs(target, { videoLocation: video, coverLocation: cover });

  assert.equal(staged.cover, path.join(target, STAGED_COVER_NAME));
  assert.equal(await fs.readFile(staged.cover!, "utf8"), "c");
});

test("a run without a cover stages only the video", async () => {
  const source = await tempDir("src-");
  const target = await tempDir("stage-");
  const video = path.join(source, "s.mp4");
  await fs.writeFile(video, "v");

  const staged = await stageOutputs(target, { videoLocation: video });

  assert.equal(staged.cover, undefined);
  assert.deepEqual(await fs.readdir(target), [STAGED_VIDEO_NAME]);
});

test("staging twice overwrites the previous run", async () => {
  const source = await tempDir("src-");
  const target = await tempDir("stage-");
  const first = path.join(source, "first.mp4");
  const second = path.join(source, "second.mp4");
  await fs.writeFile(first, "one");
  await fs.writeFile(second, "two");

  await stageOutputs(target, { videoLocation: first });
  const staged = await stageOutputs(target, { videoLocation: second });

  assert.equal(await fs.readFile(staged.mp4, "utf8"), "two");
});

test("a missing staging directory is created", async () => {
  const source = await tempDir("src-");
  const parent = await tempDir("stage-");
  const target = path.join(parent, "nested", "deeper");
  const video = path.join(source, "s.mp4");
  await fs.writeFile(video, "v");

  const staged = await stageOutputs(target, { videoLocation: video });

  assert.equal(await fs.readFile(staged.mp4, "utf8"), "v");
});
