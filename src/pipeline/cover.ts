import path from "node:path";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { VideoPayload } from "../types/video";

/** The still composition registered in src/Root.tsx. */
export const COVER_COMPOSITION_ID = "AI-Cover";

/** A cover is uploaded, not archived: a PNG of a photographic still is several times the size for no visible gain. */
export const COVER_JPEG_QUALITY = 90;

/**
 * Where the cover for a video goes: the same path, as a .jpg.
 *
 * Throws rather than returning the path it was given, so the cover can never
 * be written over the video it was made from.
 */
export function coverOutputLocation(videoLocation: string): string {
  const cover = videoLocation.replace(/\.[^./\\]*$/, "") + ".jpg";

  if (cover === videoLocation) {
    throw new Error(`Refusing to write the cover over the video (${videoLocation}).`);
  }

  return cover;
}

/**
 * Renders the thumbnail from the bundle the video was just rendered from.
 *
 * Every failure is a fallback, never a throw: the video is already written by
 * the time this runs, and a missing cover must not fail a finished render.
 */
export async function renderCover({
  serveUrl,
  payload,
  videoLocation,
}: {
  serveUrl: string;
  payload: VideoPayload;
  videoLocation: string;
}): Promise<string | undefined> {
  try {
    const outputLocation = coverOutputLocation(videoLocation);

    const composition = await selectComposition({
      serveUrl,
      id: COVER_COMPOSITION_ID,
      inputProps: { video: payload },
    });

    await renderStill({
      serveUrl,
      composition,
      output: outputLocation,
      frame: 0,
      inputProps: { video: payload },
      imageFormat: "jpeg",
      jpegQuality: COVER_JPEG_QUALITY,
      overwrite: true,
    });

    console.log(`[cover] wrote ${path.basename(outputLocation)}`);

    return outputLocation;
  } catch (error) {
    console.warn(`[cover] falling back (${error instanceof Error ? error.message : String(error)})`);

    return undefined;
  }
}
