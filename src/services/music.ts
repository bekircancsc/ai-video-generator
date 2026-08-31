import { LEAD_IN_SECONDS, TAIL_SECONDS } from "./timing";

/**
 * Volume policy for the music bed.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

/** Loud enough to be felt in the gaps, quiet enough never to compete with narration. */
export const MUSIC_BASE_GAIN = 0.18;

/** Where the bed sits while someone is speaking. */
export const MUSIC_DUCKED_GAIN = 0.05;

/** Fade at each end of the video, so the bed neither starts nor stops abruptly. */
export const MUSIC_FADE_SECONDS = 1;

/**
 * How long the duck takes to arrive and to release.
 *
 * Short on purpose. The gap between two scenes is the tail plus the lead-in
 * minus the dissolve — 0.45s — so a ramp of the half-second a mixing desk would
 * use never finishes, and the bed would sit ducked for the whole video without
 * ever reaching its base gain.
 */
export const DUCK_RAMP_SECONDS = 0.18;

/**
 * The shortest silence worth opening the bed for.
 *
 * Anything briefer than a ramp out and back in again is heard as a wobble
 * rather than as a breath, so gaps under this are swallowed and stay ducked.
 * Comfortably below the 0.45s scene join, which is meant to breathe.
 */
export const MIN_OPEN_SECONDS = 0.4;

/** A stretch of the timeline, in absolute frames, during which someone speaks. */
export type SpeechSpan = { start: number; end: number };

type TimedScene = {
  durationInFrames: number;
  audioSrc?: string;
  captions?: { start: number; end: number }[];
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Joins spans that are closer together than `minGap`, so a pause too short to
 * be heard as one never lifts the bed. Input need not be sorted.
 */
export function mergeSpans(spans: SpeechSpan[], minGap: number): SpeechSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: SpeechSpan[] = [];

  for (const span of sorted) {
    const last = merged[merged.length - 1];

    if (last && span.start - last.end < minGap) {
      last.end = Math.max(last.end, span.end);
      continue;
    }

    merged.push({ ...span });
  }

  return merged;
}

/**
 * When narration actually plays, in absolute frames.
 *
 * Word timings are used where the captions stage has produced them, so real
 * pauses inside a scene open the bed. Without them the whole padded middle of
 * the scene counts as speech, which is the safe assumption. Scenes with no clip
 * contribute nothing, which is what keeps `--no-audio` renders unducked.
 */
export function speechSpans(scenes: TimedScene[], starts: number[], fps: number): SpeechSpan[] {
  if (starts.length !== scenes.length) {
    throw new Error(`Expected one start per scene, got ${starts.length} for ${scenes.length}`);
  }

  const leadIn = Math.round(LEAD_IN_SECONDS * fps);
  const tail = Math.round(TAIL_SECONDS * fps);
  const spans: SpeechSpan[] = [];

  scenes.forEach((scene, index) => {
    if (!scene.audioSrc) {
      return;
    }

    // Caption times are relative to the clip, and the clip starts after the lead-in.
    const clipStart = starts[index] + leadIn;

    if (scene.captions && scene.captions.length > 0) {
      for (const word of scene.captions) {
        const start = clipStart + Math.round(word.start * fps);

        spans.push({ start, end: Math.max(start, clipStart + Math.round(word.end * fps)) });
      }

      return;
    }

    // A scene held at MIN_SCENE_FRAMES can be shorter than its own padding.
    const end = Math.max(clipStart, starts[index] + scene.durationInFrames - tail);

    spans.push({ start: clipStart, end });
  });

  return mergeSpans(spans, Math.round(MIN_OPEN_SECONDS * fps));
}

/**
 * How ducked the bed should be on this frame, from 0 (open) to 1 (fully under).
 *
 * The ramp in starts before the span does, so the duck has already arrived by
 * the first word instead of swallowing it.
 */
function duckAmount(frame: number, spans: SpeechSpan[], ramp: number): number {
  let amount = 0;

  for (const span of spans) {
    let reach: number;

    if (frame < span.start) {
      reach = ramp <= 0 ? 0 : (frame - (span.start - ramp)) / ramp;
    } else if (frame <= span.end) {
      reach = 1;
    } else {
      reach = ramp <= 0 ? 0 : 1 - (frame - span.end) / ramp;
    }

    amount = Math.max(amount, clamp01(reach));
  }

  return amount;
}

/** The volume Remotion should play the bed at on a given frame. */
export function musicGain(
  frame: number,
  spans: SpeechSpan[],
  totalFrames: number,
  fps: number,
): number {
  if (totalFrames <= 0) {
    return 0;
  }

  const ramp = Math.round(DUCK_RAMP_SECONDS * fps);
  const amount = duckAmount(frame, spans, ramp);
  // Weighted between the two gains rather than base plus a delta, so a full
  // duck lands exactly on MUSIC_DUCKED_GAIN instead of a float shy of it.
  const ducked = MUSIC_BASE_GAIN * (1 - amount) + MUSIC_DUCKED_GAIN * amount;

  // Shortened on a very short video so the two fades never meet: leaving one
  // frame between them keeps the bed from being silent on every frame it has.
  const fade = Math.min(Math.round(MUSIC_FADE_SECONDS * fps), Math.floor((totalFrames - 1) / 2));

  if (fade <= 0) {
    return Math.max(0, ducked);
  }

  const envelope = Math.min(clamp01(frame / fade), clamp01((totalFrames - 1 - frame) / fade));

  return Math.max(0, ducked * envelope);
}
