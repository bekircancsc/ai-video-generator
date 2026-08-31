import test from "node:test";
import assert from "node:assert/strict";
import { coverOutputLocation } from "./cover";

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
});
