/**
 * Timing policy shared by the voiceover pipeline and the Remotion components.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

/** Silence before the first word, so speech never starts on frame zero. */
export const LEAD_IN_SECONDS = 0.25;

/** Silence after the last word, so the cut does not clip the final syllable. */
export const TAIL_SECONDS = 0.5;

/** Shortest a scene may run, so a very short line still stays readable. */
export const MIN_SCENE_FRAMES = 45;

/** How long a scene must run to carry its narration comfortably. */
export function computeSceneFrames(speechSeconds: number, fps: number): number {
  const padded = LEAD_IN_SECONDS + speechSeconds + TAIL_SECONDS;
  return Math.max(MIN_SCENE_FRAMES, Math.ceil(padded * fps));
}
