import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { applyArgs, measureArgs, parseLoudnormJson, TARGET_LUFS } from "../services/loudness";

const run = promisify(execFile);

/** ffmpeg is not a dependency of this project; it is used if the machine has one. */
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

/** Two passes over a long file take a while, but never minutes. */
const TIMEOUT_MS = 300_000;

/** Where the corrected file is written before it replaces the original. */
function scratchPath(file: string): string {
  return `${file}.loudnorm.mp4`;
}

/**
 * Brings a rendered video to the streaming loudness target, in place.
 *
 * Every failure path is a warning, never a throw, for the same reason the
 * imagery stage never throws: the video is already finished by the time this
 * runs. A machine without ffmpeg, a file with no audio track, a codec ffmpeg
 * will not copy — none of those are worth losing a render over. The original
 * is left exactly as it was in all of them.
 */
export async function normaliseLoudness(videoLocation: string): Promise<boolean> {
  const scratch = scratchPath(videoLocation);

  try {
    // execFile rejects on a non-zero exit; the measurement pass exits zero and
    // writes its JSON to stderr, which is where it is read from.
    const { stderr } = await run(FFMPEG, measureArgs(videoLocation), {
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });

    const measured = parseLoudnormJson(stderr);

    await run(FFMPEG, applyArgs(videoLocation, scratch, measured), {
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });

    // Only now is the original replaced: up to this point every failure has
    // left it untouched, and a half-written scratch file is not a video.
    await fs.rename(scratch, videoLocation);

    console.log(`[loudness] ${measured.input_i} LUFS -> ${TARGET_LUFS} LUFS`);

    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[loudness] leaving the mix as rendered (${reason.split("\n")[0]})`);

    await fs.rm(scratch, { force: true }).catch(() => undefined);

    return false;
  }
}
