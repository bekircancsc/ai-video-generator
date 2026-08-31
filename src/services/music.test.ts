import test from "node:test";
import assert from "node:assert/strict";
import {
  DUCK_RAMP_SECONDS,
  mergeSpans,
  MIN_OPEN_SECONDS,
  MUSIC_BASE_GAIN,
  MUSIC_DUCKED_GAIN,
  musicGain,
  speechSpans,
} from "./music";

const FPS = 30;
// Long enough that the one-second fades at either end never reach the middle.
const TOTAL = 600;

test("a scene with audio speaks between its lead-in and its tail", () => {
  const spans = speechSpans([{ durationInFrames: 90, audioSrc: "audio/a.wav" }], [0], FPS);
  assert.deepEqual(spans, [{ start: 8, end: 75 }]);
});

test("a scene without audio contributes no span", () => {
  assert.deepEqual(speechSpans([{ durationInFrames: 90 }], [0], FPS), []);
});

test("spans are placed on the timeline, not on the scene", () => {
  const spans = speechSpans(
    [
      { durationInFrames: 90, audioSrc: "audio/a.wav" },
      { durationInFrames: 90, audioSrc: "audio/b.wav" },
    ],
    [0, 81],
    FPS,
  );
  assert.equal(spans[1].start, 81 + 8);
  assert.equal(spans[1].end, 81 + 90 - 15);
});

test("a scene too short for its own padding still yields an ordered span", () => {
  const [span] = speechSpans([{ durationInFrames: 10, audioSrc: "audio/a.wav" }], [0], FPS);
  assert.ok(span.end >= span.start, `${span.end} should not precede ${span.start}`);
});

test("the bed plays at base gain when nobody is speaking", () => {
  assert.equal(musicGain(300, [{ start: 60, end: 120 }], TOTAL, FPS), MUSIC_BASE_GAIN);
});

test("the bed ducks to the ducked gain under speech", () => {
  assert.equal(musicGain(200, [{ start: 150, end: 250 }], TOTAL, FPS), MUSIC_DUCKED_GAIN);
});

test("the duck is fully applied by the first word, not after it", () => {
  const spans = [{ start: 150, end: 250 }];
  assert.equal(musicGain(150, spans, TOTAL, FPS), MUSIC_DUCKED_GAIN);
});

test("the duck ramps down before the speech and back up after it", () => {
  const spans = [{ start: 150, end: 250 }];
  const ramp = Math.round(DUCK_RAMP_SECONDS * FPS);

  for (let frame = 150 - ramp; frame < 150; frame += 1) {
    assert.ok(
      musicGain(frame, spans, TOTAL, FPS) >= musicGain(frame + 1, spans, TOTAL, FPS),
      `gain should not rise at frame ${frame}`,
    );
  }

  for (let frame = 250; frame < 250 + ramp; frame += 1) {
    assert.ok(
      musicGain(frame, spans, TOTAL, FPS) <= musicGain(frame + 1, spans, TOTAL, FPS),
      `gain should not fall at frame ${frame}`,
    );
  }
});

test("overlapping spans duck once, without a gap between them", () => {
  const spans = [
    { start: 100, end: 200 },
    { start: 190, end: 300 },
  ];

  for (let frame = 100; frame <= 300; frame += 1) {
    assert.equal(musicGain(frame, spans, TOTAL, FPS), MUSIC_DUCKED_GAIN);
  }
});

test("the bed fades in from silence and out to silence", () => {
  assert.equal(musicGain(0, [], TOTAL, FPS), 0);
  assert.equal(musicGain(TOTAL - 1, [], TOTAL, FPS), 0);
  assert.ok(musicGain(15, [], TOTAL, FPS) > 0);
  assert.ok(musicGain(15, [], TOTAL, FPS) < MUSIC_BASE_GAIN);
});

test("a video shorter than two fades still stays inside the gain range", () => {
  for (let frame = 0; frame < 20; frame += 1) {
    const gain = musicGain(frame, [], 20, FPS);
    assert.ok(gain >= 0 && gain <= MUSIC_BASE_GAIN, `gain ${gain} out of range at ${frame}`);
  }
});

test("no span and no frames never produces a negative gain", () => {
  assert.ok(musicGain(0, [], 0, FPS) >= 0);
  assert.ok(musicGain(5, [], 1, FPS) >= 0);
});

test("a start is required for every scene", () => {
  assert.throws(
    () => speechSpans([{ durationInFrames: 90, audioSrc: "a" }, { durationInFrames: 90 }], [0], FPS),
    /one start per scene/,
  );
});

test("word timings drive the spans once captions exist", () => {
  const spans = speechSpans(
    [
      {
        durationInFrames: 150,
        audioSrc: "audio/a.wav",
        // Two words, then a full second of silence, then a third.
        captions: [
          { start: 0, end: 0.5 },
          { start: 0.6, end: 1 },
          { start: 2, end: 2.5 },
        ],
      },
    ],
    [0],
    FPS,
  );

  // The 0.1s gap is swallowed; the 1s pause survives as a gap between spans.
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0], { start: 8, end: 8 + 30 });
  assert.deepEqual(spans[1], { start: 8 + 60, end: 8 + 75 });
});

test("the bed opens inside a pause long enough to hear", () => {
  const spans = speechSpans(
    [
      {
        durationInFrames: 150,
        audioSrc: "audio/a.wav",
        captions: [
          { start: 0, end: 0.5 },
          { start: 2, end: 2.5 },
        ],
      },
    ],
    [0],
    FPS,
  );

  // Halfway through the pause, with both ramps finished.
  assert.equal(musicGain(8 + 45, spans, TOTAL, FPS), MUSIC_BASE_GAIN);
});

test("the bed breathes at the join between two scenes", () => {
  const scenes = [
    { durationInFrames: 90, audioSrc: "audio/a.wav" },
    { durationInFrames: 90, audioSrc: "audio/b.wav" },
  ];
  const starts = [0, 81];
  const spans = speechSpans(scenes, starts, FPS);
  const gains = [];

  for (let frame = 70; frame <= 95; frame += 1) {
    gains.push(musicGain(frame, spans, TOTAL, FPS));
  }

  assert.ok(
    Math.max(...gains) > (MUSIC_BASE_GAIN + MUSIC_DUCKED_GAIN) / 2,
    `the bed only reached ${Math.max(...gains)} at the scene join`,
  );
});

test("a gap shorter than the minimum open never lifts the bed", () => {
  const short = Math.round(MIN_OPEN_SECONDS * FPS) - 1;
  const spans = mergeSpans(
    [
      { start: 100, end: 200 },
      { start: 200 + short, end: 300 },
    ],
    Math.round(MIN_OPEN_SECONDS * FPS),
  );

  assert.deepEqual(spans, [{ start: 100, end: 300 }]);
});

test("merging sorts, joins and leaves real gaps alone", () => {
  assert.deepEqual(mergeSpans([{ start: 50, end: 60 }, { start: 0, end: 10 }], 12), [
    { start: 0, end: 10 },
    { start: 50, end: 60 },
  ]);
  assert.deepEqual(mergeSpans([{ start: 0, end: 10 }, { start: 5, end: 8 }], 12), [
    { start: 0, end: 10 },
  ]);
  assert.deepEqual(mergeSpans([], 12), []);
});

test("a two-frame video is not silent on both of its frames", () => {
  assert.ok(musicGain(0, [], 2, FPS) > 0 || musicGain(1, [], 2, FPS) > 0);
});
