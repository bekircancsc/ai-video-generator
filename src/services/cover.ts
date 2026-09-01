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

/**
 * Headline size for a long one. The bottom step is unbounded, so a very long
 * title simply takes more lines: at 84px the column holds roughly 21
 * characters, and the block only runs out of frame somewhere past 400.
 */
export const COVER_HEADLINE_MIN = 84;

export type CoverPlan = {
  /** Relative to public/, absent when no scene has a picture. */
  imageSrc?: string;
  themeColor: string;
  headline: string;
  kicker: string;
};

/**
 * Steps the headline down as the title lengthens.
 *
 * Character count is a proxy for width, and a coarse one: two titles of the
 * same length can differ by a wide margin, because a `W` and an `i` count the
 * same here and do not measure the same. The steps are therefore sized so that
 * a wide title in a bucket wraps to one more line rather than overflowing —
 * wrapping is the intended behaviour, not the failure. At the top step even a
 * fourteen-character title can take two lines, which is the design working.
 * The component wraps inside a word too, so a single unbreakable word cannot
 * be clipped either.
 */
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
 * than leaving the cover blank. `coverSceneId` overrides that, because the
 * best thumbnail is not always the first frame the video happens to open on
 * — and without it the only way to change a cover is to change the opening
 * scene's picture, which changes the video too.
 *
 * A named scene that never got a picture falls back to the usual search
 * rather than to a blank cover: the name is a preference, not a demand.
 */
export function coverPlan(payload: VideoPayload): CoverPlan {
  const named = payload.coverSceneId
    ? payload.scenes.find((candidate) => candidate.id === payload.coverSceneId && candidate.imageSrc)
    : undefined;
  const scene = named ?? payload.scenes.find((candidate) => candidate.imageSrc) ?? payload.scenes[0];

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
