import fs from "node:fs/promises";
import path from "node:path";
import type { VideoPayload } from "../types/video";

/**
 * Where a generated script is parked before anything expensive happens to it.
 *
 * Under `out/`, so it is gitignored along with the renders: a draft is working
 * state, not something to keep. Dated because the same niche produces the same
 * slug twice in a month, and the older draft is the less interesting one.
 */
export function draftPath(rootDir: string, slug: string, date = new Date()): string {
  return path.join(rootDir, "out", "drafts", `${date.toISOString().slice(0, 10)}-${slug}.json`);
}

/**
 * Writes the script to disk, and returns where — or undefined if it could not.
 *
 * This exists for one failure: the voiceover stage is the expensive one, it is
 * bound by a daily quota, and a run that dies inside it used to lose the script
 * as well as the audio. The next attempt then paid the quota again for a
 * freshly invented topic, which is not the same video.
 *
 * A draft that cannot be written is not worth failing a render over — the run
 * still works, it just loses its safety net — so this warns and carries on, the
 * same bargain `readHistory` makes with a corrupt history file.
 */
export async function saveDraft(
  rootDir: string,
  slug: string,
  payload: VideoPayload,
  date = new Date(),
): Promise<string | undefined> {
  const destination = draftPath(rootDir, slug, date);

  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    return destination;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`[draft] could not save the script, continuing without it: ${message}`);

    return undefined;
  }
}
