import "dotenv/config";
import type { VideoPayload } from "../types/video";
import {
  buildScriptPrompt,
  buildVideoPayloadJsonSchema,
  parseGeneratedScript,
  scriptSystemPrompt,
  type ScriptBrief,
} from "./script-schema";

type Preset = {
  baseUrl: string;
  model: string;
  /** Local runtimes accept any key, so we supply a placeholder. */
  defaultApiKey?: string;
  keyHint: string;
};

/** Presets for the OpenAI-compatible endpoints this adapter is known to work with. */
export const presets: Record<string, Preset> = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    keyHint: "Create a free key at https://console.groq.com/keys",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct",
    keyHint: "Create a key at https://openrouter.ai/keys",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyHint: "Create a key at https://platform.openai.com/api-keys",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    defaultApiKey: "ollama",
    keyHint: "Ollama runs locally and needs no key. Start it with `ollama serve`.",
  },
};

type Message = { role: "system" | "user"; content: string };

function resolveConfig(provider: string) {
  const preset = presets[provider];

  if (!preset) {
    throw new Error(
      `Unknown provider "${provider}". Supported: ${Object.keys(presets).join(", ")}, gemini, manual.`,
    );
  }

  const baseUrl = (process.env.LLM_BASE_URL || preset.baseUrl).replace(/\/+$/, "");
  const model = process.env.LLM_MODEL || preset.model;
  const apiKey = process.env.LLM_API_KEY || preset.defaultApiKey;

  if (!apiKey) {
    throw new Error(`LLM_API_KEY is missing for provider "${provider}". ${preset.keyHint}`);
  }

  return { baseUrl, model, apiKey };
}

/** Lists model ids the endpoint exposes, so a bad LLM_MODEL can report real alternatives. */
async function listModelIds(baseUrl: string, apiKey: string) {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return [];
    }

    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map((entry) => entry.id).filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

async function callChatCompletions(
  config: { baseUrl: string; model: string; apiKey: string },
  messages: Message[],
  useJsonSchema: boolean,
  jsonSchema: object,
) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.8,
      response_format: useJsonSchema
        ? {
            type: "json_schema",
            json_schema: { name: "video_payload", strict: true, schema: jsonSchema },
          }
        : { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(detail) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return body.choices?.[0]?.message?.content ?? "";
}

async function describeRequestError(
  error: Error & { status?: number },
  config: { baseUrl: string; model: string; apiKey: string },
  provider: string,
) {
  if (error.status === 401 || error.status === 403) {
    return new Error(
      `Authentication failed for "${provider}". Check LLM_API_KEY. ${presets[provider]?.keyHint ?? ""}`,
    );
  }

  if (error.status === 404 || /model/i.test(error.message)) {
    const available = await listModelIds(config.baseUrl, config.apiKey);
    const suggestion = available.length
      ? `Available models: ${available.slice(0, 15).join(", ")}`
      : `Could not list models from ${config.baseUrl}/models.`;

    return new Error(`Model "${config.model}" was rejected. Set LLM_MODEL to a valid id. ${suggestion}`);
  }

  return new Error(`Request to ${provider} failed (${error.status ?? "network"}): ${error.message}`);
}

/**
 * Generates a VideoPayload through any OpenAI-compatible chat completions endpoint.
 * Tries strict json_schema output first, falls back to json_object for endpoints
 * that do not support schemas, and retries once with the validation error attached.
 */
export async function generateWithOpenAICompatible(brief: ScriptBrief, provider: string): Promise<VideoPayload> {
  const config = resolveConfig(provider);
  const jsonSchema = buildVideoPayloadJsonSchema(brief.sceneCount);

  const messages: Message[] = [
    { role: "system", content: scriptSystemPrompt },
    { role: "user", content: buildScriptPrompt(brief) },
  ];

  let useJsonSchema = true;
  let lastValidationError = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;

    try {
      raw = await callChatCompletions(config, messages, useJsonSchema, jsonSchema);
    } catch (error) {
      const typed = error as Error & { status?: number };

      // Endpoints without json_schema support reject the request outright; retry looser.
      if (useJsonSchema && typed.status === 400) {
        useJsonSchema = false;
        attempt -= 1;
        continue;
      }

      throw await describeRequestError(typed, config, provider);
    }

    try {
      return parseGeneratedScript(raw, brief.sceneCount);
    } catch (error) {
      lastValidationError = error instanceof Error ? error.message : String(error);

      messages.push({
        role: "user",
        content: `Your previous reply was rejected. ${lastValidationError}. Return corrected JSON only.`,
      });
    }
  }

  throw new Error(`${provider} could not produce a valid payload after a repair retry. ${lastValidationError}`);
}
