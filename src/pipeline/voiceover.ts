import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWavDurationSeconds } from "../services/audio-duration";
import { computeSceneFrames } from "../services/timing";
import { resolveTtsConfig, synthesizeSpeech } from "../services/tts";
import type { VideoPayload } from "../types/video";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const audioDir = path.join(rootDir, "public", "audio");

/** Identifies a clip by its content, so unchanged narration is never re-synthesized. */
export function narrationCacheKey(narration: string, voice: string, model: string): string {
  return crypto.createHash("sha256").update(`${narration} ${voice} ${model}`).digest("hex").slice(0, 16);
}

async function readCached(file: string) {
  try {
    return await fs.readFile(file);
  } catch {
    return undefined;
  }
}

/**
 * Synthesizes narration for every scene, then retimes each scene to its clip.
 * Returns a new payload; the input is not mutated.
 */
export async function attachVoiceover(payload: VideoPayload): Promise<VideoPayload> {
  const { voice, model } = resolveTtsConfig();
  await fs.mkdir(audioDir, { recursive: true });

  const scenes = [];

  for (const scene of payload.scenes) {
    const narration = scene.narration.trim();

    if (!narration) {
      console.log(`[voiceover] ${scene.id}: no narration, leaving silent`);
      scenes.push(scene);
      continue;
    }

    const key = narrationCacheKey(narration, voice, model);
    const file = path.join(audioDir, `${key}.wav`);

    const cached = await readCached(file);
    let audio: Buffer;

    if (cached) {
      console.log(`[voiceover] ${scene.id}: cached`);
      audio = cached;
    } else {
      console.log(`[voiceover] ${scene.id}: synthesizing`);
      audio = (await synthesizeSpeech(narration)).audio;
      await fs.writeFile(file, audio);
    }

    const seconds = getWavDurationSeconds(audio);
    const durationInFrames = computeSceneFrames(seconds, payload.fps);

    console.log(`[voiceover] ${scene.id}: ${seconds.toFixed(2)}s -> ${durationInFrames} frames`);

    scenes.push({
      ...scene,
      durationInFrames,
      // staticFile() resolves against public/, so that prefix is dropped here.
      audioSrc: `audio/${key}.wav`,
    });
  }

  return { ...payload, scenes };
}
