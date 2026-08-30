import { videoPayloadSchema, type VideoPayload } from "../types/video";

/**
 * Standard JSON Schema describing a VideoPayload.
 * Used both for OpenAI-compatible `response_format: json_schema` and as
 * inline documentation inside the prompt for providers without schema support.
 */
export const videoPayloadJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    fps: { type: "integer" },
    aspectRatio: { type: "string", description: "Ratio such as 9:16" },
    scenes: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          subtext: { type: "string" },
          narration: { type: "string", description: "What the voiceover says for this scene" },
          durationInFrames: { type: "integer" },
          themeColor: { type: "string", description: "Six digit hex colour, e.g. #7c3aed" },
          keywords: { type: "array", items: { type: "string" } },
        },
        required: ["id", "text", "subtext", "narration", "durationInFrames", "themeColor", "keywords"],
      },
    },
  },
  required: ["title", "fps", "aspectRatio", "scenes"],
} as const;

export const scriptSystemPrompt =
  "You are a short-form video scriptwriter. You reply with valid JSON only, no prose and no markdown fences.";

export function buildScriptPrompt(topic: string) {
  return [
    `Generate a high-engagement social media video script for the topic: "${topic}".`,
    "Use exactly 3 scenes, each 3-4 seconds long (90-120 frames at 30fps), with punchy copy,",
    "short subtitles, vibrant six-digit hex theme colors, and a 9:16 aspect ratio.",
    "Keep `text` under 40 characters and `subtext` under 90 characters so it fits a vertical frame.",
    "Write `text` and `subtext` for the eye: short, punchy, readable at a glance.",
    "Write `narration` for the ear: one or two spoken sentences per scene, conversational,",
    "no abbreviations and no symbols, roughly 12 to 25 words, reading on naturally from the",
    "previous scene so the three narrations form one continuous voiceover.",
    "Respond with JSON matching this schema:",
    JSON.stringify(videoPayloadJsonSchema),
  ].join("\n");
}

/** Strips markdown code fences some models wrap around JSON output. */
function stripFences(raw: string) {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Parses and validates raw model output into a VideoPayload.
 * Throws with a message suitable for feeding back to the model on a repair retry.
 */
export function parseScriptJson(raw: string): VideoPayload {
  if (!raw.trim()) {
    throw new Error("The model returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (error) {
    throw new Error(`Output was not valid JSON: ${String(error)}`);
  }

  const validation = videoPayloadSchema.safeParse(parsed);

  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Payload failed schema validation: ${issues}`);
  }

  return validation.data;
}
