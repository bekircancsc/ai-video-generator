import type { VideoScene } from "../types/video";

/**
 * Turns a scene into the text an image model is asked for.
 *
 * Pure and free of Node built-ins, so it can be imported from either side of
 * the render boundary.
 */

/**
 * Appended to every prompt so all scenes of one video read as a single piece.
 */
export const IMAGE_STYLE_SUFFIX =
  ", cinematic still, moody directional lighting, deep colour, high contrast, shallow " +
  "depth of field, vertical 9:16 composition with empty space in the middle third";

/**
 * What never belongs in a frame behind captions.
 *
 * People are deliberately allowed — the script model writes subjects like "a
 * person reading a hostile comment", and a style block cannot veto its own
 * subject anyway. Real, named people are ruled out where that belongs: the
 * `imagePrompt` guidance in `script-schema.ts`.
 */
export const IMAGE_NEGATIVES = ", no logos, no watermark";

/**
 * Ruling out text is separate from the rest of the negatives because a scene
 * can need the opposite. Asking for a lift panel numbered one to five and
 * forbidding text in the same breath is a contradiction, and the model
 * resolves it by dropping the panel or by drawing letter-shaped smears. A
 * scene that sets `allowTextInImage` drops this clause and keeps the others.
 */
export const IMAGE_NO_TEXT = ", no text";

/** Used when a scene carries nothing to describe, so a render never asks for an empty picture. */
const FALLBACK_SUBJECT = "an abstract textured surface lit from one side";

function firstNonEmpty(...candidates: string[]): string {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return FALLBACK_SUBJECT;
}

export function buildImagePrompt(scene: VideoScene): string {
  const subject = firstNonEmpty(scene.imagePrompt, scene.keywords.join(", "), scene.text);
  const noText = scene.allowTextInImage ? "" : IMAGE_NO_TEXT;

  return `${subject}${IMAGE_STYLE_SUFFIX}${noText}${IMAGE_NEGATIVES}`;
}
