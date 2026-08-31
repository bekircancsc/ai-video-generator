import type { VideoPayload } from "../types/video";

/**
 * What the cover still shows, as a pure function of the payload.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

/** Headline size for a short title: as large as the frame will take. */
export const COVER_HEADLINE_MAX = 132;

/** Headline size for a long one, chosen so three lines still fit the lower third. */
export const COVER_HEADLINE_MIN = 84;

export type CoverPlan = {
  /** Relative to public/, absent when no scene has a picture. */
  imageSrc?: string;
  themeColor: string;
  headline: string;
  kicker: string;
};

/** Steps the headline down as the title lengthens, so a long title wraps rather than overflows. */
export function coverHeadlineSize(headline: string): number {
  const length = headline.trim().length;

  if (length <= 14) {
    return COVER_HEADLINE_MAX;
  }

  if (length <= 24) {
    return 116;
  }

  if (length <= 36) {
    return 100;
  }

  return COVER_HEADLINE_MIN;
}

/**
 * Chooses the picture, the colour and the two lines.
 *
 * The opening scene is the one written to hook, so its picture is the cover
 * whenever it has one; a scene whose image generation failed is skipped rather
 * than leaving the cover blank.
 */
export function coverPlan(payload: VideoPayload): CoverPlan {
  const scene = payload.scenes.find((candidate) => candidate.imageSrc) ?? payload.scenes[0];

  if (!scene) {
    throw new Error("A cover needs at least one scene");
  }

  const kicker = scene.subtext.trim() || scene.text.trim() || scene.keywords.join(" • ");

  return {
    imageSrc: scene.imageSrc,
    themeColor: scene.themeColor,
    headline: payload.title,
    kicker,
  };
}
