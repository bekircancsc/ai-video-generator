import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildResult, videoDurationSeconds } from "./result";
import type { VideoPayload } from "../types/video";

const rootDir = path.resolve("/repo");

function payload(overrides: Partial<VideoPayload> = {}): VideoPayload {
  return {
    title: "Please Do Not Press Four",
    fps: 30,
    aspectRatio: "9:16",
    scenes: [
      {
        id: "1",
        text: "a",
        subtext: "",
        narration: "The fire map goes three, then five.",
        durationInFrames: 120,
        themeColor: "#a8903c",
        keywords: ["office", "horror"],
        imagePrompt: "p",
      },
      {
        id: "2",
        text: "b",
        subtext: "",
        narration: "The lift stops there anyway.",
        durationInFrames: 90,
        themeColor: "#a8903c",
        keywords: ["horror", "lift"],
        imagePrompt: "p",
      },
    ],
    ...overrides,
  } as VideoPayload;
}

test("the result carries repo-relative forward-slash paths", () => {
  const result = buildResult({
    payload: payload(),
    videoLocation: path.join(rootDir, "out", "i-pressed-four.mp4"),
    coverLocation: path.join(rootDir, "out", "i-pressed-four.jpg"),
    rootDir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mp4, "out/i-pressed-four.mp4");
  assert.equal(result.cover, "out/i-pressed-four.jpg");
  assert.equal(result.slug, "i-pressed-four");
});

test("a run with no cover omits the field", () => {
  const result = buildResult({
    payload: payload(),
    videoLocation: path.join(rootDir, "out", "x.mp4"),
    rootDir,
  });

  assert.equal(result.cover, undefined);
});

test("youtube metadata is used when the model wrote it", () => {
  const result = buildResult({
    payload: payload({
      youtube: { title: "I Pressed Four", description: "The last one.", tags: ["officehorror"] },
    }),
    videoLocation: path.join(rootDir, "out", "x.mp4"),
    rootDir,
  });

  assert.equal(result.title, "I Pressed Four");
  assert.equal(result.description, "The last one.");
  assert.deepEqual(result.tags, ["officehorror"]);
});

test("a payload without youtube metadata falls back to the payload itself", () => {
  const result = buildResult({
    payload: payload(),
    videoLocation: path.join(rootDir, "out", "x.mp4"),
    rootDir,
  });

  assert.equal(result.title, "Please Do Not Press Four");
  assert.equal(result.description, "The fire map goes three, then five. The lift stops there anyway.");
  assert.deepEqual(result.tags, ["office", "horror", "lift"]);
});

test("the duration accounts for the transition overlap", () => {
  // 120 + 90 frames at 30fps is 7s laid end to end; one 0.3s dissolve takes 9 frames back.
  assert.equal(videoDurationSeconds(payload()), 6.7);
});

test("a single-scene payload has no overlap to subtract", () => {
  const single = payload();
  single.scenes = [single.scenes[0]];

  assert.equal(videoDurationSeconds(single), 4);
});
