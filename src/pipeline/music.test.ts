import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachMusic, planMusic } from "./music";
import type { VideoPayload } from "../types/video";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

function payload(overrides: Partial<VideoPayload> = {}): VideoPayload {
  return {
    title: "Test video",
    fps: 30,
    aspectRatio: "9:16",
    scenes: [
      {
        id: "scene1",
        text: "One",
        subtext: "",
        narration: "",
        durationInFrames: 45,
        themeColor: "#6d5df6",
        keywords: [],
        imagePrompt: "",
      },
      {
        id: "scene2",
        text: "Two",
        subtext: "",
        narration: "",
        durationInFrames: 45,
        themeColor: "#6d5df6",
        keywords: [],
        imagePrompt: "",
      },
    ],
    ...overrides,
  };
}

test("the plan covers the overlapped timeline, not the sum of the scenes", () => {
  const plan = planMusic(payload());
  assert.ok(plan.totalFrames < 90, `${plan.totalFrames} should be shorter than 45 + 45`);
  assert.equal(plan.seconds, plan.totalFrames / 30);
  assert.match(plan.relPath, /^music\/[0-9a-f]{16}\.wav$/);
});

test("the same payload plans the same file", () => {
  assert.equal(planMusic(payload()).relPath, planMusic(payload()).relPath);
});

test("a different title plans a different file", () => {
  assert.notEqual(planMusic(payload()).relPath, planMusic(payload({ title: "Other" })).relPath);
});

test("attaching music writes the bed once and reuses it", async () => {
  const plan = planMusic(payload());
  const file = path.join(publicDir, plan.relPath);
  await fs.rm(file, { force: true });

  try {
    const first = await attachMusic(payload());
    assert.equal(first.musicSrc, plan.relPath);

    const written = await fs.stat(file);
    assert.ok(written.size > 44, "the bed should contain audio, not just a header");

    const second = await attachMusic(payload());
    assert.equal(second.musicSrc, plan.relPath);
    assert.equal((await fs.stat(file)).mtimeMs, written.mtimeMs, "cached bed was rewritten");
  } finally {
    await fs.rm(file, { force: true });
  }
});

test("the input payload is not mutated", async () => {
  const input = payload();
  const plan = planMusic(input);

  try {
    await attachMusic(input);
    assert.equal(input.musicSrc, undefined);
  } finally {
    await fs.rm(path.join(publicDir, plan.relPath), { force: true });
  }
});

test("a payload the synthesizer cannot serve falls back instead of throwing", async () => {
  const broken = payload({ fps: 30, scenes: [] } as Partial<VideoPayload>);
  const result = await attachMusic(broken);
  assert.equal(result.musicSrc, undefined);
});

test("a stale musicSrc is dropped when the stage falls back", async () => {
  const broken = payload({ scenes: [], musicSrc: "music/stale.wav" } as Partial<VideoPayload>);
  const result = await attachMusic(broken);
  assert.equal(result.musicSrc, undefined);
});
