import "dotenv/config";

const GROQ_SPEECH_URL = "https://api.groq.com/openai/v1/audio/speech";
const TERMS_URL = "https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english";

export const defaultTtsModel = "canopylabs/orpheus-v1-english";
export const defaultTtsVoice = "daniel";
export const groqVoices = ["autumn", "diana", "hannah", "austin", "daniel", "troy"] as const;

export type TtsResult = {
  audio: Buffer;
  voice: string;
  model: string;
};

export function resolveTtsConfig() {
  const provider = (process.env.TTS_PROVIDER || "groq").toLowerCase();

  if (provider !== "groq") {
    throw new Error(`Unknown TTS_PROVIDER "${provider}". Only "groq" is supported.`);
  }

  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error("LLM_API_KEY is missing. Groq speech reuses the same key as script generation.");
  }

  const voice = process.env.TTS_VOICE || defaultTtsVoice;

  if (!groqVoices.includes(voice as (typeof groqVoices)[number])) {
    throw new Error(`Unsupported TTS_VOICE "${voice}". Choose one of: ${groqVoices.join(", ")}`);
  }

  return { apiKey, voice, model: process.env.TTS_MODEL || defaultTtsModel };
}

/** Turns a failed speech response into a message that says what to do next. */
export function describeTtsError(status: number, body: string): Error {
  if (status === 401 || status === 403) {
    return new Error(`Speech synthesis authentication failed (${status}). Check LLM_API_KEY.`);
  }

  if (/model_terms_required/.test(body)) {
    return new Error(`The speech model needs its terms accepted once at ${TERMS_URL}`);
  }

  if (/voice must be one of/.test(body)) {
    return new Error(`Speech synthesis rejected the voice. Set TTS_VOICE to one of: ${groqVoices.join(", ")}`);
  }

  return new Error(`Speech synthesis failed (${status}): ${body.slice(0, 300)}`);
}

/** Synthesizes one line of narration and returns the raw WAV bytes. */
export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  const { apiKey, voice, model } = resolveTtsConfig();

  const response = await fetch(GROQ_SPEECH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, voice, input: text, response_format: "wav" }),
  });

  if (!response.ok) {
    throw describeTtsError(response.status, await response.text());
  }

  return { audio: Buffer.from(await response.arrayBuffer()), voice, model };
}
