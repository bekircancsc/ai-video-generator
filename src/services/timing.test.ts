import assert from "node:assert/strict";
import { test } from "node:test";
import { LEAD_IN_SECONDS, MIN_SCENE_FRAMES, TAIL_SECONDS, computeSceneFrames } from "./timing";

test("pads speech with a lead-in and a tail", () => {
  assert.equal(computeSceneFrames(6, 30), Math.ceil((6 + LEAD_IN_SECONDS + TAIL_SECONDS) * 30));
  assert.equal(computeSceneFrames(6, 30), 203);
});

test("rounds up so the tail is never clipped", () => {
  assert.equal(computeSceneFrames(1.001, 30), 53);
});

test("applies a floor so a very short line still holds the screen", () => {
  assert.equal(computeSceneFrames(0.1, 30), MIN_SCENE_FRAMES);
});

test("respects a non-default frame rate", () => {
  assert.equal(computeSceneFrames(2, 60), 165);
});
