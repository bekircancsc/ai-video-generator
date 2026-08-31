import assert from "node:assert/strict";
import { test } from "node:test";
import { buildImagePrompt, IMAGE_STYLE_SUFFIX } from "./image-prompt";
import type { VideoScene } from "../types/video";

const scene = (over: Partial<VideoScene> = {}): VideoScene => ({
  id: "scene-1",
  text: "Stoics slept early",
  subtext: "",
  narration: "",
  durationInFrames: 90,
  themeColor: "#7c3aed",
  keywords: ["marble statue", "dawn light"],
  imagePrompt: "",
  ...over,
});

test("prefers the model's imagePrompt", () => {
  const prompt = buildImagePrompt(scene({ imagePrompt: "A lone runner on a cold bridge at dawn" }));
  assert.match(prompt, /^A lone runner on a cold bridge at dawn/);
});

test("falls back to keywords when there is no imagePrompt", () => {
  assert.match(buildImagePrompt(scene()), /^marble statue, dawn light/);
});

test("falls back to the scene text when there are no keywords either", () => {
  assert.match(buildImagePrompt(scene({ keywords: [] })), /^Stoics slept early/);
});

test("always appends the shared style block", () => {
  assert.ok(buildImagePrompt(scene()).endsWith(IMAGE_STYLE_SUFFIX));
  assert.ok(buildImagePrompt(scene({ imagePrompt: "x" })).endsWith(IMAGE_STYLE_SUFFIX));
});

test("an empty scene still produces a usable prompt", () => {
  const prompt = buildImagePrompt(scene({ keywords: [], text: "", imagePrompt: "   " }));
  assert.ok(prompt.trim().length > 0);
  assert.ok(prompt.endsWith(IMAGE_STYLE_SUFFIX));
});

test("whitespace-only fields are treated as absent", () => {
  assert.match(buildImagePrompt(scene({ imagePrompt: "   " })), /^marble statue, dawn light/);
});

test("the style block does not veto people", () => {
  assert.doesNotMatch(IMAGE_STYLE_SUFFIX, /no people|no faces|no portraits/);
});
