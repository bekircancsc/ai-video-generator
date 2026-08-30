import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { transcriptPathFor } from "../services/clip-paths";
import { resolveTranscribeConfig, transcribeWords } from "../services/transcribe";
import { captionWordSchema, type CaptionWord, type VideoPayload } from "../types/video";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const publicDir = path.join(rootDir, "public");

const cachedTranscriptSchema = z.array(captionWordSchema).nonempty();

/**
 * Validates a parsed transcript cache payload. Anything that isn't a
 * non-empty array of well-formed caption words is treated as invalid
 * (undefined) rather than trusted — an empty array in particular would
 * otherwise ship a video with no captions and no error.
 */
export function parseCachedTranscript(raw: unknown): CaptionWord[] | undefined {
  const result = cachedTranscriptSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

async function readCachedWords(file: string): Promise<CaptionWord[] | undefined> {
  let raw: string;

  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[captions] ${file}: cached transcript is not valid JSON, re-transcribing`);
    return undefined;
  }

  const words = parseCachedTranscript(parsed);

  if (!words) {
    console.warn(`[captions] ${file}: cached transcript failed validation, re-transcribing`);
    return undefined;
  }

  return words;
}

/**
 * Transcribes every scene's narration clip and stamps the word timings onto it.
 * Returns a new payload; the input is not mutated. Scene durations are left
 * alone: the voiceover stage already set them from the measured clip length.
 */
export async function attachCaptions(payload: VideoPayload): Promise<VideoPayload> {
  const { model: transcribeModel } = resolveTranscribeConfig();
  const scenes = [];

  for (const scene of payload.scenes) {
    if (!scene.audioSrc) {
      console.log(`[captions] ${scene.id}: no audio, skipping`);
      // Strip any stale captions carried over from the input payload (e.g. a
      // saved payload re-rendered after its narration/audioSrc was removed) —
      // otherwise captions would be drawn over silence.
      const { captions: _staleCaptions, ...rest } = scene;
      scenes.push(rest);
      continue;
    }

    const audioFile = path.join(publicDir, scene.audioSrc);
    const transcriptFile = path.join(publicDir, transcriptPathFor(scene.audioSrc, transcribeModel));

    const cached = await readCachedWords(transcriptFile);
    let words: CaptionWord[];

    if (cached) {
      console.log(`[captions] ${scene.id}: cached`);
      words = cached;
    } else {
      console.log(`[captions] ${scene.id}: transcribing`);

      let audio: Buffer;
      try {
        audio = await fs.readFile(audioFile);
      } catch {
        throw new Error(
          `[captions] ${scene.id}: narration clip is missing at ${audioFile}. ` +
            `Run the voiceover stage first, or check "audioSrc" in the payload.`
        );
      }

      words = await transcribeWords(audio);
      await fs.writeFile(transcriptFile, JSON.stringify(words));
    }

    console.log(`[captions] ${scene.id}: ${words.length} words`);

    scenes.push({ ...scene, captions: words });
  }

  return { ...payload, scenes };
}
