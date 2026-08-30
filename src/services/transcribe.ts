import "dotenv/config";
import type { CaptionWord } from "../types/video";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export const defaultTranscribeModel = "whisper-large-v3-turbo";

export function resolveTranscribeConfig() {
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error("LLM_API_KEY is missing. Groq transcription reuses the same key as script generation.");
  }

  return { apiKey, model: process.env.TRANSCRIBE_MODEL || defaultTranscribeModel };
}

/** Turns a failed transcription response into a message that says what to do next. */
export function describeTranscribeError(status: number, body: string): Error {
  if (status === 401 || status === 403) {
    return new Error(`Transcription authentication failed (${status}). Check LLM_API_KEY.`);
  }

  if (status === 429) {
    return new Error("Transcription hit the Groq rate limit. Wait a moment and run the render again.");
  }

  return new Error(`Transcription failed (${status}): ${body.slice(0, 300)}`);
}

/** Pulls word timings out of a verbose_json transcription response. */
export function extractWords(payload: unknown): CaptionWord[] {
  const words = (payload as { words?: unknown }).words;

  if (!Array.isArray(words) || words.length === 0) {
    throw new Error("Transcription returned no word timings. Confirm the model supports timestamp_granularities.");
  }

  return words.map((entry) => {
    const { word, start, end } = entry as Partial<CaptionWord>;

    if (typeof word !== "string" || typeof start !== "number" || typeof end !== "number") {
      throw new Error("Transcription returned a malformed word entry");
    }

    return { word: word.trim(), start, end };
  });
}

/** Transcribes one WAV clip and returns its word-level timings. */
export async function transcribeWords(audio: Buffer): Promise<CaptionWord[]> {
  const { apiKey, model } = resolveTranscribeConfig();

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "narration.wav");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    throw describeTranscribeError(response.status, await response.text());
  }

  return extractWords(await response.json());
}
