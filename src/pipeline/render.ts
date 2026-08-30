import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { defaultProvider, generateScript, loadPayloadFile } from "../services/script-provider";
import { attachVoiceover } from "./voiceover";
import { attachCaptions } from "./captions";
import type { VideoPayload } from "../types/video";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const outDir = path.join(rootDir, "out");
const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "video";
}

export async function renderVideo(
  topic: string,
  payloadOverride?: VideoPayload,
  options: { audio?: boolean } = {},
) {
  const script = payloadOverride ?? (await generateScript(topic));
  const payload =
    options.audio === false ? script : await attachCaptions(await attachVoiceover(script));

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

  const outputLocation = path.join(outDir, `${slugify(topic)}.mp4`);

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

  return {
    outputLocation,
    payload,
  };
}

/** Reads `--topic <value>` and `--payload <file>`, tolerating bare positional topics. */
export function parseArgs(argv: string[]) {
  const flagValue = (flag: string) => {
    const index = argv.indexOf(flag);

    if (index === -1) {
      return undefined;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }

    return value;
  };

  const payloadFile = flagValue("--payload");
  const topicFlag = flagValue("--topic");
  const consumed = new Set([topicFlag, payloadFile, "--topic", "--payload", "--no-audio", "--"]);
  const positional = argv.filter((arg) => !consumed.has(arg)).join(" ").trim();

  return {
    payloadFile,
    topic: topicFlag ?? positional,
    audio: !argv.includes("--no-audio"),
  };
}

if (isDirectRun) {
  const run = async () => {
    const { topic, payloadFile, audio } = parseArgs(process.argv.slice(2));

    if (payloadFile) {
      const payload = await loadPayloadFile(payloadFile);
      const name = topic || payload.title;
      console.log(`Rendering payload from ${payloadFile}`);
      const result = await renderVideo(name, payload, { audio });
      console.log(`Render complete: ${result.outputLocation}`);
      return;
    }

    if (!topic) {
      throw new Error("A topic must be provided via --topic, or a script via --payload <file.json>");
    }

    const provider = process.env.SCRIPT_PROVIDER || defaultProvider;
    console.log(`Generating video for topic: ${topic} (provider: ${provider})`);
    const result = await renderVideo(topic, undefined, { audio });
    console.log(`Render complete: ${result.outputLocation}`);
  };

  run().catch((error) => {
    console.error("Render failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
