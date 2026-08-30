import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import type { VideoPayload } from "../types/video";
import { parseScriptJson } from "./script-schema";
import { generateWithOpenAICompatible, presets } from "./openai-compatible";

export const defaultProvider = "groq";

/**
 * Loads a hand-written or agent-written payload from disk.
 * This is the no-API-key path: the script is authored elsewhere and rendered as-is.
 */
export async function loadPayloadFile(filePath: string): Promise<VideoPayload> {
  const resolved = path.resolve(process.cwd(), filePath);

  let raw: string;
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch {
    throw new Error(`Could not read payload file: ${resolved}`);
  }

  try {
    return parseScriptJson(raw);
  } catch (error) {
    throw new Error(`${resolved} is not a valid video payload. ${error instanceof Error ? error.message : error}`);
  }
}

/** Generates a payload using whichever provider SCRIPT_PROVIDER selects. */
export async function generateScript(topic: string): Promise<VideoPayload> {
  const provider = (process.env.SCRIPT_PROVIDER || defaultProvider).toLowerCase();

  if (provider === "manual") {
    throw new Error(
      "SCRIPT_PROVIDER=manual expects a payload file. Run with --payload <file.json>, or set SCRIPT_PROVIDER to a live provider.",
    );
  }

  if (provider === "gemini") {
    const { generateVideoPayload } = await import("./gemini");
    return generateVideoPayload(topic);
  }

  if (provider in presets) {
    return generateWithOpenAICompatible(topic, provider);
  }

  throw new Error(
    `Unknown SCRIPT_PROVIDER "${provider}". Supported: ${Object.keys(presets).join(", ")}, gemini, manual.`,
  );
}
