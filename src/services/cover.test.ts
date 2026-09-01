import test from "node:test";
import assert from "node:assert/strict";
import {
  COVER_HEADLINE_MAX,
  COVER_HEADLINE_MIN,
  coverHeadlineSize,
  coverPlan,
} from "./cover";
import type { VideoPayload, VideoScene } from "../types/video";

function scene(overrides: Partial<VideoScene> = {}): VideoScene {
  return {
    id: "scene-1",
    text: "A headline",
    subtext: "A supporting line",
    narration: "",
    durationInFrames: 90,
    themeColor: "#7c3aed",
    keywords: ["one", "two"],
    imagePrompt: "",
    ...overrides,
  };
}

function payload(scenes: VideoScene[], title = "The Future of AI"): VideoPayload {
  return { title, fps: 30, aspectRatio: "9:16", scenes };
}

test("the cover uses the first scene that has a picture", () => {
  const plan = coverPlan(
    payload([
      scene({ id: "scene-1" }),
      scene({ id: "scene-2", imageSrc: "images/a.jpg", themeColor: "#22c55e", subtext: "Second" }),
      scene({ id: "scene-3", imageSrc: "images/b.jpg", themeColor: "#38bdf8" }),
    ]),
  );

  assert.equal(plan.imageSrc, "images/a.jpg");
  assert.equal(plan.themeColor, "#22c55e");
  assert.equal(plan.kicker, "Second");
});

test("with no picture anywhere the cover falls back to the first scene", () => {
  const plan = coverPlan(payload([scene({ themeColor: "#111111" }), scene({ id: "scene-2" })]));

  assert.equal(plan.imageSrc, undefined);
  assert.equal(plan.themeColor, "#111111");
});

test("the headline is the payload title", () => {
  assert.equal(coverPlan(payload([scene()], "Negative Visualization")).headline, "Negative Visualization");
});

test("the kicker falls back from subtext to text to keywords to nothing", () => {
  assert.equal(coverPlan(payload([scene({ subtext: "Sub" })])).kicker, "Sub");
  assert.equal(coverPlan(payload([scene({ subtext: "  ", text: "Text" })])).kicker, "Text");
  assert.equal(
    coverPlan(payload([scene({ subtext: "", text: "", keywords: ["stoic", "calm"] })])).kicker,
    "stoic • calm",
  );
  assert.equal(coverPlan(payload([scene({ subtext: "", text: "", keywords: [] })])).kicker, "");
});

test("a single-scene payload still produces a cover", () => {
  const plan = coverPlan(payload([scene({ imageSrc: "images/only.jpg" })]));

  assert.equal(plan.imageSrc, "images/only.jpg");
});

test("a payload with no scenes is refused rather than drawn blank", () => {
  assert.throws(() => coverPlan(payload([])), /at least one scene/);
});

test("the headline shrinks as the title lengthens and never leaves its bounds", () => {
  const sizes = [0, 10, 20, 30, 40, 60, 120].map((length) => coverHeadlineSize("t".repeat(length)));

  sizes.forEach((size, index) => {
    assert.ok(size <= COVER_HEADLINE_MAX && size >= COVER_HEADLINE_MIN, `${size} out of bounds`);

    if (index > 0) {
      assert.ok(size <= sizes[index - 1], `${size} should not exceed ${sizes[index - 1]}`);
    }
  });

  assert.equal(sizes[0], COVER_HEADLINE_MAX);
  assert.equal(sizes[sizes.length - 1], COVER_HEADLINE_MIN);
});

test("every step of the headline size is where it claims to be", () => {
  // Pinned at the boundaries, not sampled around them: sampling passes just as
  // happily when a step in the middle has been dropped altogether.
  assert.equal(coverHeadlineSize("t".repeat(14)), 132);
  assert.equal(coverHeadlineSize("t".repeat(15)), 116);
  assert.equal(coverHeadlineSize("t".repeat(24)), 116);
  assert.equal(coverHeadlineSize("t".repeat(25)), 100);
  assert.equal(coverHeadlineSize("t".repeat(36)), 100);
  assert.equal(coverHeadlineSize("t".repeat(37)), 84);
});

test("surrounding whitespace does not shrink the headline", () => {
  // Long enough to change bucket if the padding were counted, which is the
  // only way this test can fail at all.
  const padded = `   ${"t".repeat(14)}   `;

  assert.equal(coverHeadlineSize(padded), COVER_HEADLINE_MAX);
});

test("takes the cover from the scene the payload names", () => {
  const plan = coverPlan({
    ...payload([
      scene({ id: "a", imageSrc: "images/a.jpg", themeColor: "#111111" }),
      scene({ id: "b", imageSrc: "images/b.jpg", themeColor: "#222222", subtext: "the better frame" }),
    ]),
    coverSceneId: "b",
  });

  assert.equal(plan.imageSrc, "images/b.jpg");
  assert.equal(plan.themeColor, "#222222");
  assert.equal(plan.kicker, "the better frame");
});

test("falls back to the first picture when the named scene never got one", () => {
  const plan = coverPlan({
    ...payload([scene({ id: "a", imageSrc: "images/a.jpg" }), scene({ id: "b" })]),
    coverSceneId: "b",
  });

  assert.equal(plan.imageSrc, "images/a.jpg");
});
