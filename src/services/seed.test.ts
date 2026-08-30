import assert from "node:assert/strict";
import { test } from "node:test";
import { seedFromId, seededUnit } from "./seed";

test("the same id always yields the same seed", () => {
  assert.equal(seedFromId("scene-1"), seedFromId("scene-1"));
});

test("different ids yield different seeds", () => {
  const seeds = new Set(["scene-1", "scene-2", "scene-3", "a", "b"].map(seedFromId));
  assert.equal(seeds.size, 5);
});

test("draws stay inside the unit interval", () => {
  for (const id of ["scene-1", "scene-2", "scene-3"]) {
    for (let index = 0; index < 12; index += 1) {
      const value = seededUnit(seedFromId(id), index);
      assert.ok(value >= 0 && value < 1, `${id}[${index}] was ${value}`);
    }
  }
});

test("a draw is stable for the same seed and index", () => {
  assert.equal(seededUnit(seedFromId("scene-1"), 3), seededUnit(seedFromId("scene-1"), 3));
});

test("consecutive indices give unrelated draws", () => {
  const seed = seedFromId("scene-1");
  const draws = [0, 1, 2, 3, 4, 5].map((index) => seededUnit(seed, index));
  assert.equal(new Set(draws).size, draws.length);
});

/**
 * Scene ids differ only in their last character, so a weak mix produces nearly
 * identical first draws and every scene ends up looking the same. This guards
 * against that specific failure.
 */
test("ids that differ by one character still spread apart", () => {
  const first = ["scene-1", "scene-2", "scene-3"].map((id) => seededUnit(seedFromId(id), 0));

  for (let a = 0; a < first.length; a += 1) {
    for (let b = a + 1; b < first.length; b += 1) {
      assert.ok(
        Math.abs(first[a] - first[b]) > 0.05,
        `draws ${first[a]} and ${first[b]} are too close together`,
      );
    }
  }
});
