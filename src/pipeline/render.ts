import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { defaultProvider, generateScript, loadPayloadFile } from "../services/script-provider";
import { parseArgs } from "../services/cli-args";
import { attachVoiceover } from "./voiceover";
import { attachCaptions } from "./captions";
import { attachImagery } from "./imagery";
import { attachMusic } from "./music";
import { removeCover, renderCover } from "./cover";
import type { VideoPayload } from "../types/video";
import type { ScriptBrief } from "../services/script-schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const outDir = path.join(rootDir, "out");
const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "video";
}

export async function renderVideo(
  brief: ScriptBrief,
  payloadOverride?: VideoPayload,
  options: { audio?: boolean; images?: boolean; music?: boolean; cover?: boolean } = {},
) {
  const script = payloadOverride ?? (await generateScript(brief));
  const spoken =
    options.audio === false ? script : await attachCaptions(await attachVoiceover(script));
  const illustrated = options.images === false ? spoken : await attachImagery(spoken);
  // Dropping musicSrc, not just skipping the stage: a saved payload carries one,
  // and public/music/ is gitignored, so playing it could fail the render.
  const { musicSrc: _muted, ...silent } = illustrated;
  const payload = options.music === false ? silent : await attachMusic(illustrated);

  const entryPoint = path.join(rootDir, "src", "Root.tsx");
  const bundleDir = path.join(rootDir, ".cache", "remotion");

  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(bundleDir, { recursive: true });

  const serveUrl = await bundle({
    entryPoint,
    outDir: bundleDir,
  });

  const composition = await selectComposition({
    serveUrl,
    id: "AI-Video",
    inputProps: { video: payload },
  });

  const outputLocation = path.join(outDir, `${slugify(brief.topic || payload.title)}.mp4`);

  await renderMedia({
    serveUrl,
    composition,
    outputLocation,
    codec: "h264",
    inputProps: { video: payload },
    onProgress: (progress) => {
      const percentage = Math.round(progress.progress * 100);
      console.log(`[render] ${percentage}% complete`);
    },
  });

  let coverLocation: string | undefined;

  if (options.cover === false) {
    // Output names come from the topic, so this render may have just replaced
    // a video that had a cover. Leaving it would pair this video with the
    // previous one's thumbnail.
    await removeCover(outputLocation);
  } else {
    coverLocation = await renderCover({ serveUrl, payload, videoLocation: outputLocation });
  }

  return {
    outputLocation,
    coverLocation,
    payload,
  };
}

if (isDirectRun) {
  const run = async () => {
    const { topic, niche, sceneCount, payloadFile, audio, images, music, cover } = parseArgs(process.argv.slice(2));
    const brief: ScriptBrief = { topic, niche, sceneCount };

    if (payloadFile) {
      const payload = await loadPayloadFile(payloadFile);
      console.log(`Rendering payload from ${payloadFile}`);
      const result = await renderVideo(brief, payload, { audio, images, music, cover });
      console.log(`Render complete: ${result.outputLocation}`);

      if (result.coverLocation) {
        console.log(`Cover: ${result.coverLocation}`);
      }

      return;
    }

    if (!topic && !niche) {
      throw new Error(
        "A topic or a niche must be provided via --topic or --niche, or a script via --payload <file.json>",
      );
    }

    const provider = process.env.SCRIPT_PROVIDER || defaultProvider;
    const subject = topic ? `topic: ${topic}` : `niche: ${niche}`;
    const scenes = sceneCount ? `, ${sceneCount} scenes` : "";
    console.log(`Generating video for ${subject} (provider: ${provider}${scenes})`);

    const result = await renderVideo(brief, undefined, { audio, images, music, cover });
    console.log(`Render complete: ${result.outputLocation}`);

    if (result.coverLocation) {
      console.log(`Cover: ${result.coverLocation}`);
    }
  };

  run().catch((error) => {
    console.error("Render failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
