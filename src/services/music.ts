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

/** How long the duck takes to arrive and to release. */
export const DUCK_RAMP_SECONDS = 0.4;

/** A stretch of the timeline, in absolute frames, during which someone speaks. */
export type SpeechSpan = { start: number; end: number };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * When each scene's narration plays, in absolute frames.
 *
 * Derived from the timeline rather than from the audio file: the voiceover
 * stage already sized every scene as lead-in + speech + tail, so the speech is
 * exactly what is left when both paddings are removed. Scenes without a clip
 * contribute nothing, which is what keeps `--no-audio` renders unducked.
 */
export function speechSpans(
  scenes: { durationInFrames: number; audioSrc?: string }[],
  starts: number[],
  fps: number,
): SpeechSpan[] {
  const leadIn = Math.round(LEAD_IN_SECONDS * fps);
  const tail = Math.round(TAIL_SECONDS * fps);
  const spans: SpeechSpan[] = [];

  scenes.forEach((scene, index) => {
    if (!scene.audioSrc) {
      return;
    }

    const start = (starts[index] ?? 0) + leadIn;
    // A scene held at the minimum length can be shorter than its own padding.
    const end = Math.max(start, (starts[index] ?? 0) + scene.durationInFrames - tail);

    spans.push({ start, end });
  });

  return spans;
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
  const ramp = Math.round(DUCK_RAMP_SECONDS * fps);
  const amount = duckAmount(frame, spans, ramp);
  // Weighted between the two gains rather than base plus a delta, so a full
  // duck lands exactly on MUSIC_DUCKED_GAIN instead of a float shy of it.
  const ducked = MUSIC_BASE_GAIN * (1 - amount) + MUSIC_DUCKED_GAIN * amount;

  // Halved on a very short video so the fade in and the fade out never overlap.
  const fade = Math.min(Math.round(MUSIC_FADE_SECONDS * fps), Math.floor(totalFrames / 2));

  if (fade <= 0) {
    return Math.max(0, ducked);
  }

  const envelope = Math.min(clamp01(frame / fade), clamp01((totalFrames - 1 - frame) / fade));

  return Math.max(0, ducked * envelope);
}
