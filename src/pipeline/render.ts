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
import { normaliseLoudness } from "./loudness";
import { buildResult, type RunFailure } from "../services/result";
import { appendHistory, readHistory, recentTitles } from "../services/history";
import { stageOutputs } from "../services/stage";
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
  options: { audio?: boolean; images?: boolean; music?: boolean; cover?: boolean; loudness?: boolean } = {},
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

  // After the render, because integrated loudness is a property of the
  // finished mix, and before the cover, so a failure here cannot leave a
  // thumbnail beside a video that is still being rewritten.
  if (options.loudness !== false) {
    await normaliseLoudness(outputLocation);
  }

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
  /**
   * Under --json, stdout carries the result object and nothing else.
   *
   * Everything that would have gone to stdout is pushed to stderr for the
   * duration of the run — including anything a library writes to the stream
   * directly — and the result is written through this saved reference at the
   * end. A caller parses the whole of stdout; a person reads stderr.
   */
  const stdoutWrite = process.stdout.write.bind(process.stdout);

  const run = async () => {
    const { topic, niche, nicheFile, stageDir, sceneCount, payloadFile, audio, images, music, cover, loudness, json } =
      parseArgs(process.argv.slice(2));

    if (json) {
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
        (process.stderr.write as (...args: never[]) => boolean)(
          chunk as never,
          ...(rest as never[]),
        )) as typeof process.stdout.write;
    }

    let briefNiche = niche;

    if (nicheFile) {
      const resolved = path.resolve(process.cwd(), nicheFile);

      try {
        briefNiche = await fs.readFile(resolved, "utf8");
      } catch {
        throw new Error(`Could not read niche file: ${resolved}`);
      }

      if (!briefNiche.trim()) {
        throw new Error(`The niche file is empty: ${resolved}`);
      }
    }

    // A payload file names its own video; the avoid list only shapes a
    // generated script, so it is not read on that path.
    const avoidTopics = payloadFile ? undefined : recentTitles(await readHistory(rootDir));
    const brief: ScriptBrief = { topic, niche: briefNiche, sceneCount, avoidTopics };

    let payload: VideoPayload | undefined;

    if (payloadFile) {
      payload = await loadPayloadFile(payloadFile);
      console.log(`Rendering payload from ${payloadFile}`);
    } else {
      if (!topic && !briefNiche) {
        throw new Error(
          "A topic or a niche must be provided via --topic, --niche or --niche-file, or a script via --payload <file.json>",
        );
      }

      const provider = process.env.SCRIPT_PROVIDER || defaultProvider;
      const subject = topic ? `topic: ${topic}` : nicheFile ? `niche file: ${nicheFile}` : `niche: ${briefNiche}`;
      const scenes = sceneCount ? `, ${sceneCount} scenes` : "";
      const avoiding = avoidTopics?.length ? `, avoiding ${avoidTopics.length} published titles` : "";
      console.log(`Generating video for ${subject} (provider: ${provider}${scenes}${avoiding})`);
    }

    const result = await renderVideo(brief, payload, { audio, images, music, cover, loudness });

    console.log(`Render complete: ${result.outputLocation}`);

    if (result.coverLocation) {
      console.log(`Cover: ${result.coverLocation}`);
    }

    const summary = buildResult({
      payload: result.payload,
      videoLocation: result.outputLocation,
      coverLocation: result.coverLocation,
      rootDir,
    });

    if (stageDir) {
      const staged = await stageOutputs(path.resolve(process.cwd(), stageDir), {
        videoLocation: result.outputLocation,
        coverLocation: result.coverLocation,
      });

      summary.stagedMp4 = staged.mp4;
      summary.stagedCover = staged.cover;

      console.log(`Staged: ${staged.mp4}${staged.cover ? ` and ${staged.cover}` : ""}`);
    }

    // Only a generated script goes in the history: a payload file was written
    // by hand, and its topic was never the model's to choose again.
    if (!payloadFile) {
      await appendHistory(rootDir, {
        date: new Date().toISOString().slice(0, 10),
        slug: summary.slug,
        title: summary.title,
        topic: topic || nicheFile || "",
      });
    }

    if (json) {
      stdoutWrite(`${JSON.stringify(summary)}\n`);
    }
  };

  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    console.error("Render failed:", message);

    // Read from argv rather than the parsed args: parseArgs itself may be what
    // threw, and the failure still has to come back as JSON.
    if (process.argv.includes("--json")) {
      const failure: RunFailure = { ok: false, error: message };
      stdoutWrite(`${JSON.stringify(failure)}\n`);
    }

    process.exitCode = 1;
  });
}
