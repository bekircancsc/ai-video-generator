import { videoPayloadSchema, type VideoPayload } from "../types/video";

/** The scene count a generated script may use. Hand-written payload files are exempt. */
export const MIN_SCENES = 3;
export const MAX_SCENES = 8;

/** What a run is asking for. At least one of `topic` or `niche` is set by the CLI. */
export type ScriptBrief = {
  topic?: string;
  niche?: string;
  sceneCount?: number;
  /** Titles already published on this channel. The model is told not to repeat them. */
  avoidTopics?: string[];
};

/**
 * Standard JSON Schema describing a VideoPayload.
 * Used both for OpenAI-compatible `response_format: json_schema` and as
 * inline documentation inside the prompt for providers without schema support.
 *
 * The scene bounds are the strong half of the count guarantee: an endpoint that
 * honours the schema cannot return the wrong number of scenes.
 */
export function buildVideoPayloadJsonSchema(sceneCount?: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      fps: { type: "integer" },
      aspectRatio: { type: "string", description: "Ratio such as 9:16" },
      youtube: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "Title read cold in a feed, under 70 characters" },
          description: {
            type: "string",
            description: "Two or three sentences for someone deciding whether to watch",
          },
          tags: { type: "array", items: { type: "string" }, description: "Search terms, not adjectives" },
        },
        required: ["title", "description", "tags"],
      },
      scenes: {
        type: "array",
        minItems: sceneCount ?? MIN_SCENES,
        maxItems: sceneCount ?? MAX_SCENES,
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
            imagePrompt: {
              type: "string",
              description: "One sentence describing what the viewer sees in this scene",
            },
          },
          required: [
            "id",
            "text",
            "subtext",
            "narration",
            "durationInFrames",
            "themeColor",
            "keywords",
            "imagePrompt",
          ],
        },
      },
    },
    required: ["title", "fps", "aspectRatio", "youtube", "scenes"],
  };
}

export const scriptSystemPrompt =
  "You are a short-form video scriptwriter. You reply with valid JSON only, no prose and no markdown fences.";

/** A niche given as a document is quoted as a document, not interpolated into a sentence. */
function nicheBlock(niche: string) {
  return ["The channel is defined by this brief:", "---", niche.trim(), "---"];
}

function isDocument(niche: string) {
  return niche.includes("\n");
}

/** The opening sentences, which differ by what the brief actually names. */
function briefLines({ topic, niche }: ScriptBrief) {
  if (!topic && !niche) {
    throw new Error("A script brief needs a topic or a niche");
  }

  if (topic && niche) {
    return isDocument(niche)
      ? [
          `Generate a high-engagement social media video script for the topic: "${topic}".`,
          ...nicheBlock(niche),
          "Match that brief's audience, tone and vocabulary.",
        ]
      : [
          `Generate a high-engagement social media video script for the topic: "${topic}".`,
          `The video is for a channel in this niche: "${niche}".`,
          "Match that niche's audience, tone and vocabulary.",
        ];
  }

  if (niche) {
    return isDocument(niche)
      ? [
          "Generate a high-engagement social media video script for the channel described below.",
          ...nicheBlock(niche),
          "Pick one specific, high-engagement topic within that brief and write the script for it.",
          "Match that brief's audience, tone and vocabulary.",
        ]
      : [
          `Generate a high-engagement social media video script for a channel in this niche: "${niche}".`,
          "Pick one specific, high-engagement topic within that niche and write the script for it.",
          "Match that niche's audience, tone and vocabulary.",
        ];
  }

  return [`Generate a high-engagement social media video script for the topic: "${topic}".`];
}

/**
 * Titles the channel has already published.
 *
 * A model asked to pick its own topic from a fixed niche converges on the same
 * few ideas within a month, so the list of what has already gone out is part of
 * the brief.
 */
function avoidLines(avoidTopics?: string[]) {
  if (!avoidTopics || avoidTopics.length === 0) {
    return [];
  }

  return [
    "These videos have already been published on this channel. Do not repeat them,",
    "and do not write a near-duplicate of one under a different title:",
    ...avoidTopics.map((title) => `- ${title}`),
  ];
}

function sceneCountLine(sceneCount?: number) {
  if (sceneCount !== undefined) {
    return `Use exactly ${sceneCount} scenes, each 3-4 seconds long (90-120 frames at 30fps), with punchy copy,`;
  }

  return (
    `Use between ${MIN_SCENES} and ${MAX_SCENES} scenes — pick the number the subject actually needs, ` +
    "more for a topic with more steps — each 3-4 seconds long (90-120 frames at 30fps), with punchy copy,"
  );
}

export function buildScriptPrompt(brief: ScriptBrief) {
  return [
    ...briefLines(brief),
    ...avoidLines(brief.avoidTopics),
    sceneCountLine(brief.sceneCount),
    "short subtitles, vibrant six-digit hex theme colors, and a 9:16 aspect ratio.",
    "Keep `text` under 40 characters and `subtext` under 90 characters so it fits a vertical frame.",
    "Write `text` and `subtext` for the eye: short, punchy, readable at a glance.",
    "Write `narration` for the ear: one or two spoken sentences per scene, conversational,",
    "no abbreviations and no symbols, roughly 12 to 25 words, reading on naturally from the",
    "previous scene so the scene narrations form one continuous voiceover.",
    "Write `imagePrompt` for the camera: one concrete, filmable sentence describing a single",
    "image for that scene — subject, setting and lighting, no text or logos in the picture,",
    "no named real people.",
    "Write `youtube.title` to be read cold in a feed by someone who has never seen this channel:",
    "under 70 characters, concrete, no clickbait punctuation and no emoji.",
    "Write `youtube.description` for someone deciding whether to watch: two or three sentences,",
    "no timestamps and no links. Write it from inside the video's own world, in the same voice",
    "the narration uses. Never describe the video, its style, its pacing or how it was made —",
    "a listing that comments on its own craft breaks the spell it is selling.",
    "Write `youtube.tags` as six to ten search terms someone would actually type. Terms, not adjectives.",
    "Respond with JSON matching this schema:",
    JSON.stringify(buildVideoPayloadJsonSchema(brief.sceneCount)),
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

/**
 * Parses model output and enforces the scene count the brief asked for.
 * The thrown message is fed back to the model by the repair retry, so it names
 * both the expectation and what arrived.
 */
export function parseGeneratedScript(raw: string, sceneCount?: number): VideoPayload {
  const payload = parseScriptJson(raw);
  const actual = payload.scenes.length;

  if (sceneCount !== undefined && actual !== sceneCount) {
    throw new Error(`The script must have exactly ${sceneCount} scenes, got ${actual}`);
  }

  if (sceneCount === undefined && (actual < MIN_SCENES || actual > MAX_SCENES)) {
    throw new Error(`The script must have between ${MIN_SCENES} and ${MAX_SCENES} scenes, got ${actual}`);
  }

  return payload;
}
