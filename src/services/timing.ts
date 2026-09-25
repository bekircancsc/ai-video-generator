/**
 * Timing policy shared by the voiceover pipeline and the Remotion components.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

/** Silence before the first word, so speech never starts on frame zero. */
export const LEAD_IN_SECONDS = 0.25;

/**
 * How long the opening scene's `text` stays on screen as the hook. Shorts
 * viewers decide in about this long whether to swipe, and on frame zero the
 * voice has not started yet, so the words have to be on the picture already.
 */
export const HOOK_SECONDS = 2;

/** Silence after the last word, so the cut does not clip the final syllable. */
export const TAIL_SECONDS = 0.5;

/** Shortest a scene may run, so a very short line still stays readable. */
export const MIN_SCENE_FRAMES = 45;

/** How long a scene must run to carry its narration comfortably. */
export function computeSceneFrames(speechSeconds: number, fps: number): number {
  const padded = LEAD_IN_SECONDS + speechSeconds + TAIL_SECONDS;
  return Math.max(MIN_SCENE_FRAMES, Math.ceil(padded * fps));
}

/**
 * Cross-dissolve length between consecutive scenes: long enough to read as a
 * dissolve rather than a cut, short enough to fit inside the tail silence
 * every clip already carries, so speech is never clipped.
 */
export const TRANSITION_SECONDS = 0.3;

/**
 * The dissolve in frames, for a given frame rate.
 *
 * Expressed in seconds and converted here rather than stored as a frame count:
 * `fps` comes from the payload and the model may pick any value, so a fixed
 * count would silently halve the dissolve at 60fps. Capped at the tail silence
 * so the overlap can never reach back into the outgoing scene's speech,
 * however slow the frame rate.
 */
export function transitionFrames(fps: number): number {
  return Math.max(0, Math.min(Math.round(TRANSITION_SECONDS * fps), Math.floor(TAIL_SECONDS * fps)));
}

/**
 * How far one scene may reach back into the one before it.
 *
 * Clamped to both neighbours so that starts stay strictly increasing and no
 * scene is swallowed whole. Only reachable from a hand-written `--payload`:
 * a generated scene is at least MIN_SCENE_FRAMES long, far longer than any
 * dissolve.
 */
function effectiveOverlap(previousDuration: number, currentDuration: number, overlap: number): number {
  return Math.max(0, Math.min(overlap, previousDuration - 1, currentDuration - 1));
}

/** Frame each scene starts on, once overlaps are applied. */
export function sceneStartFrames(durations: number[], overlap: number): number[] {
  const starts: number[] = [];
  let cursor = 0;

  durations.forEach((duration, index) => {
    if (index === 0) {
      starts.push(0);
      cursor = duration;
      return;
    }

    const start = cursor - effectiveOverlap(durations[index - 1], duration, overlap);
    starts.push(start);
    cursor = start + duration;
  });

  return starts;
}

/** Total frames the timeline occupies, overlaps included. */
export function timelineFrames(durations: number[], overlap: number): number {
  if (durations.length === 0) {
    return 0;
  }

  const starts = sceneStartFrames(durations, overlap);

  return starts[starts.length - 1] + durations[durations.length - 1];
}
