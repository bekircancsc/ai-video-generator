import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { coverOutputLocation, removeCover, renderCover } from "./cover";
import type { VideoPayload } from "../types/video";

const payload: VideoPayload = {
  title: "A Cover",
  fps: 30,
  aspectRatio: "9:16",
  scenes: [
    {
      id: "scene-1",
      text: "A headline",
      subtext: "A supporting line",
      narration: "",
      durationInFrames: 90,
      themeColor: "#7c3aed",
      keywords: [],
      imagePrompt: "",
    },
  ],
};

async function scratchVideo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cover-test-"));

  return path.join(dir, "clip.mp4");
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

test("the cover sits beside the video, as a jpg", () => {
  assert.equal(coverOutputLocation("/out/stoic-habits.mp4"), "/out/stoic-habits.jpg");
});

test("a dot in a directory name is not an extension", () => {
  assert.equal(coverOutputLocation("/a.dir/out/clip.mp4"), "/a.dir/out/clip.jpg");
  assert.equal(coverOutputLocation("C:\\a.dir\\out\\clip.mp4"), "C:\\a.dir\\out\\clip.jpg");
});

test("a path with no extension gains one rather than being overwritten", () => {
  assert.equal(coverOutputLocation("/out/clip"), "/out/clip.jpg");
});

test("the cover refuses to be written over the video", () => {
  assert.throws(() => coverOutputLocation("/out/clip.jpg"), /Refusing/);
  // Windows and macOS would treat these as one file.
  assert.throws(() => coverOutputLocation("C:\\out\\clip.JPG"), /Refusing/);
});

/**
 * These exercise the failure paths that need no browser. The rendering paths
 * are inside the same try and are covered by `npm run test:render`; opening a
 * real bundle here would put a Chromium launch in the unit suite.
 */
test("a cover that cannot even be given a path is a fallback, not a throw", async () => {
  const dir = path.dirname(await scratchVideo());

  // coverOutputLocation refuses this, from inside renderCover's try.
  const cover = await renderCover({
    serveUrl: dir,
    payload,
    videoLocation: path.join(dir, "clip.jpg"),
  });

  assert.equal(cover, undefined);
});

test("a stale cover does not outlive the video it belonged to", async () => {
  const videoLocation = await scratchVideo();
  const stale = coverOutputLocation(videoLocation);
  await fs.writeFile(stale, "a cover from an earlier render");

  await removeCover(videoLocation);

  assert.equal(await exists(stale), false);
});

test("removing a cover that is not there is not an error", async () => {
  const videoLocation = await scratchVideo();

  await removeCover(videoLocation);

  assert.equal(await exists(coverOutputLocation(videoLocation)), false);
});
