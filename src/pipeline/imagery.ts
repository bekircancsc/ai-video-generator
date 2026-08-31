import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImagePrompt } from "../services/image-prompt";
import { imageCacheKey, imagePathFor } from "../services/clip-paths";
import { generateImage, resolveImageConfig, type ImageConfig } from "../services/image-gen";
import { seedFromId } from "../services/seed";
import type { VideoPayload, VideoScene } from "../types/video";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const publicDir = path.join(rootDir, "public");

/**
 * The decision half of the stage: what to ask for, where it is cached, and
 * which seed draws it. Pure, so it can be tested without fs or network.
 *
 * The key deliberately excludes the scene id: two scenes asking for the same
 * picture should share one file. The seed does depend on the id, so scenes
 * that ask for different pictures never draw the same one.
 */
export function planSceneImage(scene: VideoScene, config: ImageConfig) {
  const prompt = buildImagePrompt(scene);
  const key = imageCacheKey(prompt, config.provider, config.model, config.width, config.height);

  return { prompt, key, relPath: imagePathFor(key), seed: seedFromId(scene.id) };
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
 * Generates one background image per scene and stamps its path onto the scene.
 * Returns a new payload; the input is not mutated.
 *
 * Every failure path is a fallback, never a throw: a scene without `imageSrc`
 * simply renders the aurora background, so imagery can never fail a render.
 */
export async function attachImagery(payload: VideoPayload): Promise<VideoPayload> {
  let config: ImageConfig;

  try {
    config = resolveImageConfig();
  } catch (error) {
    console.warn(`[imagery] disabled: ${error instanceof Error ? error.message : String(error)}`);
    return payload;
  }

  if (config.provider === "none") {
    console.log("[imagery] provider is none, keeping the drawn background");
    return payload;
  }

  await fs.mkdir(path.join(publicDir, "images"), { recursive: true });

  const scenes: VideoScene[] = [];

  for (const scene of payload.scenes) {
    const { prompt, relPath, seed } = planSceneImage(scene, config);
    const file = path.join(publicDir, relPath);

    if (await exists(file)) {
      console.log(`[imagery] ${scene.id}: cached`);
      scenes.push({ ...scene, imageSrc: relPath });
      continue;
    }

    console.log(`[imagery] ${scene.id}: generating`);

    try {
      const bytes = await generateImage(prompt, seed, config);
      await fs.writeFile(file, bytes);
      scenes.push({ ...scene, imageSrc: relPath });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[imagery] ${scene.id}: falling back (${reason})`);
      const { imageSrc: _stale, ...rest } = scene;
      scenes.push(rest);
    }
  }

  return { ...payload, scenes };
}
