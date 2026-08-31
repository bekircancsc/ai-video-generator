import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { musicCacheKey, musicPathFor } from "../services/clip-paths";
import { MUSIC_FORMAT_VERSION, synthesizeBed } from "../services/music-gen";
import { seedFromId } from "../services/seed";
import { timelineFrames, transitionFrames } from "../services/timing";
import type { VideoPayload } from "../types/video";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const publicDir = path.join(rootDir, "public");

/**
 * The decision half of the stage: how long the bed runs, which seed draws it
 * and where it is cached. Pure, so it can be tested without fs.
 *
 * The length comes from the overlapped timeline rather than the sum of the
 * scene durations, so the bed's own fade-out lands on the last frame.
 */
export function planMusic(payload: VideoPayload) {
  const totalFrames = timelineFrames(
    payload.scenes.map((scene) => scene.durationInFrames),
    transitionFrames(payload.fps),
  );

  return {
    seed: seedFromId(payload.title),
    totalFrames,
    seconds: totalFrames / payload.fps,
    relPath: musicPathFor(
      musicCacheKey(seedFromId(payload.title), totalFrames, payload.fps, MUSIC_FORMAT_VERSION),
    ),
  };
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Synthesizes the bed for this video and stamps its path onto the payload.
 * Returns a new payload; the input is not mutated.
 *
 * Every failure path is a fallback, never a throw: a payload without
 * `musicSrc` simply renders with speech alone, so music can never fail a
 * render.
 */
export async function attachMusic(payload: VideoPayload): Promise<VideoPayload> {
  const { musicSrc: _stale, ...rest } = payload;

  try {
    const { seed, seconds, relPath } = planMusic(payload);
    const file = path.join(publicDir, relPath);

    if (await exists(file)) {
      console.log("[music] cached");
      return { ...rest, musicSrc: relPath };
    }

    console.log(`[music] synthesizing ${seconds.toFixed(2)}s`);
    await fs.mkdir(path.join(publicDir, "music"), { recursive: true });
    // Written beside the cache path and renamed into place. A bed is megabytes:
    // an interrupted write straight to `file` would leave a truncated WAV that
    // every later render treats as a cache hit and hands to ffmpeg.
    const pending = `${file}.${process.pid}.tmp`;
    await fs.writeFile(pending, synthesizeBed(seed, seconds));
    await fs.rename(pending, file);

    return { ...rest, musicSrc: relPath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[music] falling back (${reason})`);

    return rest;
  }
}
