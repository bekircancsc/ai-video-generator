import type { VideoScene } from "../types/video";

/**
 * Turns a scene into the text an image model is asked for.
 *
 * Pure and free of Node built-ins, so it can be imported from either side of
 * the render boundary.
 */

/** Appended to every prompt so all scenes of one video read as a single piece. */
export const IMAGE_STYLE_SUFFIX =
  ", cinematic still, dark moody palette, high contrast, shallow depth of field, " +
  "soft rim lighting, vertical 9:16 composition with empty space in the middle third, " +
  "no text, no logos, no watermark, no recognisable real people";

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

  return `${subject}${IMAGE_STYLE_SUFFIX}`;
}
