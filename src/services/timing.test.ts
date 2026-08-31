import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEAD_IN_SECONDS,
  MIN_SCENE_FRAMES,
  TAIL_SECONDS,
  TRANSITION_SECONDS,
  transitionFrames,
  computeSceneFrames,
  sceneStartFrames,
  timelineFrames,
} from "./timing";

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

test("scenes step forward by their duration minus the overlap", () => {
  assert.deepEqual(sceneStartFrames([90, 90, 90], 9), [0, 81, 162]);
});

test("the first scene always starts at frame zero", () => {
  assert.equal(sceneStartFrames([90, 90], 9)[0], 0);
  assert.equal(sceneStartFrames([90], 9)[0], 0);
});

test("the timeline is shorter than the sum by one overlap per join", () => {
  assert.equal(timelineFrames([90, 90, 90], 9), 270 - 2 * 9);
  assert.equal(timelineFrames([60, 120], 9), 180 - 9);
});

test("a single scene is its own length and starts at zero", () => {
  assert.deepEqual(sceneStartFrames([120], 9), [0]);
  assert.equal(timelineFrames([120], 9), 120);
});

test("an empty timeline is empty", () => {
  assert.deepEqual(sceneStartFrames([], 9), []);
  assert.equal(timelineFrames([], 9), 0);
});

test("an overlap of zero reproduces back-to-back scenes", () => {
  assert.deepEqual(sceneStartFrames([90, 60, 30], 0), [0, 90, 150]);
  assert.equal(timelineFrames([90, 60, 30], 0), 180);
});

test("a scene shorter than the overlap never starts before the one before it", () => {
  const starts = sceneStartFrames([90, 5, 90], 9);
  assert.ok(starts[1] > starts[0], `${starts[1]} should follow ${starts[0]}`);
  assert.ok(starts[2] > starts[1], `${starts[2]} should follow ${starts[1]}`);
});

test("several short scenes in a row still step forward, one frame at a time", () => {
  // Each scene may swallow all but one frame of the one before it, so a chain
  // of scenes at the overlap length degenerates to a one-frame stagger rather
  // than to scenes sharing a start frame.
  assert.deepEqual(sceneStartFrames([9, 9, 9], 9), [0, 1, 2]);
});

test("the timeline covers the end of every scene", () => {
  for (const durations of [[90, 90, 90], [90, 5, 90], [90, 9], [9, 9, 9], [45], [60, 120, 30]]) {
    const starts = sceneStartFrames(durations, 9);
    const lastEnd = Math.max(...starts.map((start, index) => start + durations[index]));
    assert.equal(
      timelineFrames(durations, 9),
      lastEnd,
      `timeline for ${durations.join(",")} must reach ${lastEnd}`
    );
  }
});

test("a short scene at the end still adds to the timeline", () => {
  assert.ok(timelineFrames([90, 9], 9) > 90, "the closing scene must not be swallowed");
});

test("the dissolve is a fixed length in seconds, whatever the frame rate", () => {
  assert.equal(transitionFrames(30), Math.round(TRANSITION_SECONDS * 30));
  assert.equal(transitionFrames(60), Math.round(TRANSITION_SECONDS * 60));
  assert.equal(transitionFrames(24), Math.round(TRANSITION_SECONDS * 24));
});

test("the dissolve never reaches back into the outgoing scene's speech", () => {
  for (const fps of [12, 24, 25, 30, 50, 60]) {
    assert.ok(
      transitionFrames(fps) <= Math.floor(TAIL_SECONDS * fps),
      `at ${fps}fps the dissolve must fit inside the tail silence`
    );
  }
});
