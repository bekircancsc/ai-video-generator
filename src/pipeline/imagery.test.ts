import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { planSceneImage, attachImagery } from "./imagery";
import { resolveImageConfig } from "../services/image-gen";
import type { VideoPayload, VideoScene } from "../types/video";

const scene = (over: Partial<VideoScene> = {}): VideoScene => ({
  id: "scene-1",
  text: "Stoics slept early",
  subtext: "",
  narration: "",
  durationInFrames: 90,
  themeColor: "#7c3aed",
  keywords: ["marble statue"],
  imagePrompt: "A lone runner on a cold bridge at dawn",
  ...over,
});

const payload = (scenes: VideoScene[]): VideoPayload => ({
  title: "T",
  fps: 30,
  aspectRatio: "9:16",
  scenes,
});

test("the plan carries the prompt, a cache path and a scene-derived seed", () => {
  const plan = planSceneImage(scene(), resolveImageConfig({}));
  assert.match(plan.prompt, /^A lone runner on a cold bridge at dawn/);
  assert.equal(plan.relPath, `images/${plan.key}.jpg`);
  assert.equal(plan.seed, planSceneImage(scene(), resolveImageConfig({})).seed);
});

test("two scenes with the same prompt share one cached file", () => {
  const config = resolveImageConfig({});
  const first = planSceneImage(scene({ id: "a" }), config);
  const second = planSceneImage(scene({ id: "b" }), config);
  assert.equal(first.relPath, second.relPath);
});

test("different scenes get different seeds", () => {
  const config = resolveImageConfig({});
  assert.notEqual(planSceneImage(scene({ id: "a" }), config).seed, planSceneImage(scene({ id: "b" }), config).seed);
});

test("the none provider leaves every scene untouched and makes no request", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("no request should be made");
  }) as typeof globalThis.fetch;

  try {
    process.env.IMAGE_PROVIDER = "none";
    const result = await attachImagery(payload([scene()]));
    assert.equal(result.scenes[0].imageSrc, undefined);
  } finally {
    delete process.env.IMAGE_PROVIDER;
    globalThis.fetch = original;
  }
});

test("a provider failure falls back instead of throwing", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof globalThis.fetch;

  try {
    process.env.IMAGE_PROVIDER = "pollinations";
    const result = await attachImagery(payload([scene({ imagePrompt: `fallback probe ${Date.now()}` })]));
    assert.equal(result.scenes[0].imageSrc, undefined);
    assert.equal(result.scenes.length, 1);
  } finally {
    delete process.env.IMAGE_PROVIDER;
    globalThis.fetch = original;
  }
});

test("a bad configuration falls back for the whole payload", async () => {
  try {
    process.env.IMAGE_PROVIDER = "midjourney";
    const result = await attachImagery(payload([scene()]));
    assert.equal(result.scenes[0].imageSrc, undefined);
  } finally {
    delete process.env.IMAGE_PROVIDER;
  }
});

test("a generated image is written and stamped onto the scene", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })) as typeof globalThis.fetch;

  try {
    process.env.IMAGE_PROVIDER = "pollinations";
    const unique = `a unique probe subject ${Date.now()}`;
    const result = await attachImagery(payload([scene({ imagePrompt: unique })]));
    assert.match(String(result.scenes[0].imageSrc), /^images\/[0-9a-f]{16}\.jpg$/);

    // The stub wrote four bytes of nothing; leaving it behind would put a
    // broken image in the cache for a later real render to pick up.
    const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
    await fs.rm(path.join(publicDir, String(result.scenes[0].imageSrc)), { force: true });
  } finally {
    delete process.env.IMAGE_PROVIDER;
    globalThis.fetch = original;
  }
});
