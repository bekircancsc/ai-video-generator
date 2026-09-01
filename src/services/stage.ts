import fs from "node:fs/promises";
import path from "node:path";

/**
 * Fixed names for the staged copies.
 *
 * Fixed, not slugged, so whatever picks the files up can be configured with a
 * constant path. An automation that has to compute the filename from the run's
 * own output needs a templating step, and that step is one more thing to get
 * wrong for no gain — nothing reads these copies except the upload that
 * immediately follows.
 */
export const STAGED_VIDEO_NAME = "video.mp4";
export const STAGED_COVER_NAME = "cover.jpg";

export type StagedOutputs = {
  mp4: string;
  cover?: string;
};

/**
 * Copies a finished render into a directory something else is allowed to read.
 *
 * The originals stay in `out/`, named after their topic — this is a drop box,
 * not a move. Each run overwrites the last, because the previous video has
 * already been collected by the time the next one is made.
 */
export async function stageOutputs(
  targetDir: string,
  { videoLocation, coverLocation }: { videoLocation: string; coverLocation?: string },
): Promise<StagedOutputs> {
  await fs.mkdir(targetDir, { recursive: true });

  const mp4 = path.join(targetDir, STAGED_VIDEO_NAME);
  await fs.copyFile(videoLocation, mp4);

  if (!coverLocation) {
    return { mp4 };
  }

  const cover = path.join(targetDir, STAGED_COVER_NAME);
  await fs.copyFile(coverLocation, cover);

  return { mp4, cover };
}
