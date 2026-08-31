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
};

export function resolveImageConfig(env: NodeJS.ProcessEnv = process.env): ImageConfig {
  const provider = (env.IMAGE_PROVIDER || defaultImageProvider).toLowerCase();

  if (provider === "none") {
    return { provider: "none", model: "", width: 0, height: 0 };
  }

  if (provider === "pollinations") {
    return {
      provider: "pollinations",
      model: env.IMAGE_MODEL || defaultPollinationsModel,
      ...POLLINATIONS_SIZE,
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

async function generateWithPollinations(prompt: string, seed: number, config: ImageConfig): Promise<Buffer> {
  const query = new URLSearchParams({
    width: String(config.width),
    height: String(config.height),
    model: config.model,
    // The seed comes from the scene id, so a rerun without a cache draws the same picture.
    seed: String(seed),
    nologo: "true",
  });

  const response = await fetchWithTimeout(`${POLLINATIONS_URL}/${encodeURIComponent(prompt)}?${query}`);

  if (!response.ok) {
    throw describeImageError("pollinations", response.status, await response.text());
  }

  return Buffer.from(await response.arrayBuffer());
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
