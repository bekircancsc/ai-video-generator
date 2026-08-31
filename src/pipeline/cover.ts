import fs from "node:fs/promises";
import path from "node:path";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { VideoPayload } from "../types/video";

/** The still composition registered in src/Root.tsx. */
const COVER_COMPOSITION_ID = "AI-Cover";

/** A cover is uploaded, not archived: a PNG of a photographic still is several times the size for no visible gain. */
const COVER_JPEG_QUALITY = 90;

/**
 * Where the cover for a video goes: the same path, as a .jpg.
 *
 * Throws rather than returning the path it was given, so the cover can never
 * be written over the video it was made from. The comparison ignores case
 * because Windows and macOS filesystems do: "clip.JPG" and "clip.jpg" are one
 * file there, and returning the second for the first would be the very
 * overwrite this guards against.
 */
export function coverOutputLocation(videoLocation: string): string {
  const cover = videoLocation.replace(/\.[^./\\]*$/, "") + ".jpg";

  if (cover.toLowerCase() === videoLocation.toLowerCase()) {
    throw new Error(`Refusing to write the cover over the video (${videoLocation}).`);
  }

  return cover;
}

/**
 * Deletes the cover belonging to a video, if there is one.
 *
 * Output names come from the topic, so re-rendering the same topic overwrites
 * the video in place. A run that skips the cover, or whose cover fails, would
 * otherwise leave the previous run's thumbnail sitting beside a different
 * video under the matching name, with nothing to say the pair no longer
 * belongs together. Missing files and unlink errors are ignored: this is
 * tidying, and it may not fail a render either.
 */
export async function removeCover(videoLocation: string): Promise<void> {
  try {
    await fs.rm(coverOutputLocation(videoLocation), { force: true });
  } catch (error) {
    console.warn(`[cover] could not remove a stale cover (${error instanceof Error ? error.message : String(error)})`);
  }
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

    // A half-written still, or one left by an earlier render of the same
    // topic, would be mistaken for this video's cover.
    await removeCover(videoLocation);

    return undefined;
  }
}
