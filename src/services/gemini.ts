import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import type { VideoPayload } from "../types/video";
import { buildScriptPrompt, parseScriptJson } from "./script-schema";

/** Google's schema dialect uses uppercase type names, so it stays separate from the standard one. */
const responseSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    fps: { type: "INTEGER" },
    aspectRatio: { type: "STRING" },
    scenes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          text: { type: "STRING" },
          subtext: { type: "STRING" },
          durationInFrames: { type: "INTEGER" },
          themeColor: { type: "STRING" },
          keywords: {
            type: "ARRAY",
            items: { type: "STRING" },
          },
        },
        required: ["id", "text", "subtext", "durationInFrames", "themeColor", "keywords"],
      },
    },
  },
  required: ["title", "fps", "aspectRatio", "scenes"],
} as const;

export function createGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Add it to your .env file");
  }

  return new GoogleGenAI({ apiKey });
}

export async function generateVideoPayload(topic: string): Promise<VideoPayload> {
  const client = createGeminiClient();

  const response = await client.models
    .generateContent({
      model: process.env.LLM_MODEL || "gemini-2.5-flash",
      contents: buildScriptPrompt(topic),
      config: {
        responseMimeType: "application/json",
        responseSchema,
      },
    })
    .catch((error: unknown) => {
      const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;

      if (status === 401 || status === 403) {
        throw new Error(
          "Gemini authentication failed. Check that GEMINI_API_KEY is a valid Google AI Studio API key, that the key has no HTTP referrer or IP restrictions, and that the Generative Language API is enabled for its project.",
        );
      }

      throw error;
    });

  return parseScriptJson(response.text ?? "");
}
