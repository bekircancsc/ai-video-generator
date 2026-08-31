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

test("surrounding whitespace does not shrink the headline", () => {
  assert.equal(coverHeadlineSize("   short   "), coverHeadlineSize("short"));
});
