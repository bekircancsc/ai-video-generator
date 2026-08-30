import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWavDurationSeconds } from "../services/audio-duration";
import { clipPathFor, narrationCacheKey } from "../services/clip-paths";
import { computeSceneFrames } from "../services/timing";
import { resolveTtsConfig, synthesizeSpeech } from "../services/tts";
import type { VideoPayload } from "../types/video";

// Re-exported for callers (and existing tests) that import the cache-key
// helper from here; the convention itself now lives in services/clip-paths.
export { narrationCacheKey };

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const publicDir = path.join(rootDir, "public");

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
  await fs.mkdir(path.join(publicDir, "audio"), { recursive: true });

  const scenes = [];

  for (const scene of payload.scenes) {
    const narration = scene.narration.trim();

    if (!narration) {
      console.log(`[voiceover] ${scene.id}: no narration, leaving silent`);
      scenes.push(scene);
      continue;
    }

    const key = narrationCacheKey(narration, voice, model);
    const relPath = clipPathFor(key);
    const file = path.join(publicDir, relPath);

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
      audioSrc: relPath,
    });
  }

  return { ...payload, scenes };
}
