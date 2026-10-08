import "dotenv/config";

/**
 * Generates one still image per call. Free providers only: the default needs
 * no API key at all, so a fresh clone renders pictures without any setup.
 *
 * Node-side only — the pipeline calls this before the render, never a
 * component during it.
 */

const POLLINATIONS_URL = "https://image.pollinations.ai/prompt";
const TOGETHER_URL = "https://api.together.xyz/v1/images/generations";

/**
 * Providers take a seed as a signed 32-bit integer and reject anything larger
 * with an opaque validation error, while `seedFromId` returns an unsigned
 * 32-bit hash. Every seed is folded into range before it is sent.
 */
const MAX_SEED = 2_147_483_647;

/** A minute is long for one image and short enough not to stall a render. */
const REQUEST_TIMEOUT_MS = 60_000;

export const defaultImageProvider = "pollinations";
export const defaultPollinationsModel = "flux";
export const defaultTogetherModel = "black-forest-labs/FLUX.1-schnell-Free";

/**
 * The frame is 1080x1920. FLUX needs multiples of 16, so together renders
 * smaller and the browser scales it up with `cover`.
 */
const POLLINATIONS_SIZE = { width: 1080, height: 1920 };
const TOGETHER_SIZE = { width: 768, height: 1344 };

export type ImageProvider = "pollinations" | "together" | "none";

export type ImageConfig = {
  provider: ImageProvider;
  model: string;
  apiKey?: string;
  width: number;
  height: number;
  /** How long to wait before each retry of a refused request. Empty means one attempt. */
  retryDelaysMs?: number[];
};

/**
 * Since 2026-09-28 pollinations serves an unauthenticated caller about one
 * image every two to three minutes and answers anything sooner with an empty
 * 402. Asked back to back, every scene after the first fell back to the drawn
 * background, on every nightly video. Waiting it out costs a few minutes of a
 * runner; not waiting cost the pictures.
 */
const POLLINATIONS_RETRY_DELAYS_MS = [45_000, 90_000, 120_000];

/** Statuses that mean "not now" rather than "never": worth waiting for. */
const RETRYABLE_STATUSES = new Set([402, 429, 500, 502, 503, 504]);

export function resolveImageConfig(env: NodeJS.ProcessEnv = process.env): ImageConfig {
  const provider = (env.IMAGE_PROVIDER || defaultImageProvider).toLowerCase();

  if (provider === "none") {
    return { provider: "none", model: "", width: 0, height: 0 };
  }

  if (provider === "pollinations") {
    return {
      provider: "pollinations",
      model: env.IMAGE_MODEL || defaultPollinationsModel,
      // Optional. A free pollinations account's token lifts the anonymous rate limit.
      apiKey: env.IMAGE_API_KEY || undefined,
      ...POLLINATIONS_SIZE,
      retryDelaysMs: POLLINATIONS_RETRY_DELAYS_MS,
    };
  }

  if (provider === "together") {
    const apiKey = env.IMAGE_API_KEY;

    if (!apiKey) {
      throw new Error('IMAGE_API_KEY is missing. IMAGE_PROVIDER="together" needs a Together.ai key.');
    }

    return {
      provider: "together",
      model: env.IMAGE_MODEL || defaultTogetherModel,
      apiKey,
      ...TOGETHER_SIZE,
    };
  }

  throw new Error(`Unknown IMAGE_PROVIDER "${provider}". Choose one of: pollinations, together, none.`);
}

/** Turns a failed image response into a message that says what to do next. */
export function describeImageError(provider: string, status: number, body: string): Error {
  if (status === 401 || status === 403) {
    return new Error(`Image generation authentication failed (${status}) on ${provider}. Check IMAGE_API_KEY.`);
  }

  if (status === 429) {
    return new Error(`Image generation hit the ${provider} rate limit. Wait a moment and run the render again.`);
  }

  return new Error(`Image generation failed on ${provider} (${status}): ${body.slice(0, 200)}`);
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pollinations answers 200 with a weaker model than the one asked for when it
 * does not accept the caller, and says so only in headers. That swap went
 * unnoticed for a week, so it is logged; a request served as asked says nothing.
 * A cache hit carries no model header at all, so it is logged too, or silence
 * would mean either.
 */
export function warnIfModelSwapped(response: Response, requested: string): void {
  if (response.headers.get("x-cache")?.toUpperCase() === "HIT") {
    console.warn(`[imagery] pollinations returned a cached picture; the model that drew it is unknown`);
    return;
  }

  const served = response.headers.get("x-model-used");

  if (served && served !== requested) {
    const auth = response.headers.get("x-auth-status") ?? "unknown";
    console.warn(`[imagery] pollinations served ${served} instead of ${requested} (auth: ${auth})`);
  }
}

async function generateWithPollinations(prompt: string, seed: number, config: ImageConfig): Promise<Buffer> {
  const query = new URLSearchParams({
    width: String(config.width),
    height: String(config.height),
    model: config.model,
    // The seed comes from the scene id, so a rerun without a cache draws the same picture.
    seed: String(seed),
    nologo: "true",
    // The CDN in front of pollinations caches by exact URL and ignores the
    // token, so without this a token-holding run is handed whatever an
    // anonymous request for the same scene got earlier — sana's picture. The
    // extra parameter gives authenticated requests URLs of their own.
    ...(config.apiKey ? { private: "true" } : {}),
  });

  const url = `${POLLINATIONS_URL}/${encodeURIComponent(prompt)}?${query}`;
  // The token goes in a header, never the URL, so it stays out of logs.
  const init = config.apiKey ? { headers: { Authorization: `Bearer ${config.apiKey}` } } : undefined;
  const delays = config.retryDelaysMs ?? [];

  for (let attempt = 0; ; attempt++) {
    let refusal: Error;

    try {
      const response = await fetchWithTimeout(url, init);

      if (response.ok) {
        warnIfModelSwapped(response, config.model);
        return Buffer.from(await response.arrayBuffer());
      }

      refusal = describeImageError("pollinations", response.status, await response.text());

      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw refusal;
      }
    } catch (error) {
      // A timed-out request is retried like a refusal; anything else is final.
      if (!(error instanceof Error) || error.name !== "AbortError") {
        throw error;
      }

      refusal = error;
    }

    if (attempt >= delays.length) {
      throw refusal;
    }

    console.log(`[imagery] pollinations refused (${refusal.message}), retrying in ${delays[attempt] / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
  }
}

async function generateWithTogether(prompt: string, seed: number, config: ImageConfig): Promise<Buffer> {
  const response = await fetchWithTimeout(TOGETHER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      width: config.width,
      height: config.height,
      seed,
      n: 1,
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    throw describeImageError("together", response.status, await response.text());
  }

  const payload = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const encoded = payload.data?.[0]?.b64_json;

  if (!encoded) {
    throw new Error("Image generation returned no image data from together");
  }

  return Buffer.from(encoded, "base64");
}

/** Generates one image and returns its raw bytes. */
export async function generateImage(
  prompt: string,
  seed: number,
  config: ImageConfig = resolveImageConfig()
): Promise<Buffer> {
  if (config.provider === "none") {
    throw new Error('Image generation was called while IMAGE_PROVIDER is "none"');
  }

  const safeSeed = Math.abs(Math.trunc(seed)) % MAX_SEED;

  const bytes =
    config.provider === "pollinations"
      ? await generateWithPollinations(prompt, safeSeed, config)
      : await generateWithTogether(prompt, safeSeed, config);

  if (bytes.byteLength === 0) {
    throw new Error(`Image generation returned an empty body from ${config.provider}`);
  }

  return bytes;
}
