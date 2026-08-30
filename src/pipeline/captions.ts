import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcribeWords } from "../services/transcribe";
import type { CaptionWord, VideoPayload } from "../types/video";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const publicDir = path.join(rootDir, "public");

/** Transcript cache path for a clip: audio/<key>.wav becomes audio/<key>.json */
export function transcriptPathFor(audioSrc: string): string {
  return audioSrc.replace(/\.wav$/i, ".json");
}

async function readCachedWords(file: string): Promise<CaptionWord[] | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as CaptionWord[];
  } catch {
    return undefined;
  }
}

/**
 * Transcribes every scene's narration clip and stamps the word timings onto it.
 * Returns a new payload; the input is not mutated. Scene durations are left
 * alone: the voiceover stage already set them from the measured clip length.
 */
export async function attachCaptions(payload: VideoPayload): Promise<VideoPayload> {
  const scenes = [];

  for (const scene of payload.scenes) {
    if (!scene.audioSrc) {
      console.log(`[captions] ${scene.id}: no audio, skipping`);
      scenes.push(scene);
      continue;
    }

    const audioFile = path.join(publicDir, scene.audioSrc);
    const transcriptFile = path.join(publicDir, transcriptPathFor(scene.audioSrc));

    const cached = await readCachedWords(transcriptFile);
    let words: CaptionWord[];

    if (cached) {
      console.log(`[captions] ${scene.id}: cached`);
      words = cached;
    } else {
      console.log(`[captions] ${scene.id}: transcribing`);
      words = await transcribeWords(await fs.readFile(audioFile));
      await fs.writeFile(transcriptFile, JSON.stringify(words));
    }

    console.log(`[captions] ${scene.id}: ${words.length} words`);

    scenes.push({ ...scene, captions: words });
  }

  return { ...payload, scenes };
}
