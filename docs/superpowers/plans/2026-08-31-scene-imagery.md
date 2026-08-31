# AI Scene Imagery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every scene a generated still image as its background — produced before the render, cached on disk, and animated with a slow zoom — while the aurora background stays as the silent fallback.

**Architecture:** A new pipeline stage `attachImagery` runs after `attachCaptions`, writes images into `public/images/`, and stamps `imageSrc` onto each scene. Remotion reads only local files through `staticFile()`, so the render stays deterministic and offline. Provider choice lives behind a seam (`pollinations` keyless default, `together`, `none`) mirroring `SCRIPT_PROVIDER`.

**Tech Stack:** TypeScript ES modules, Node 22 (`node:test`, global `fetch`), Zod 4, Remotion 4, tsx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-31-scene-imagery-design.md`. Branch: `feature/scene-imagery`.
- **Never modify `src/services/gemini.ts`.**
- Free providers only. The default provider must work with **no API key**.
- Imagery must never fail a render: any error, timeout, or empty body falls back to the aurora background with one log line.
- All prose, prompts, log lines and comments in **English**.
- `src/services/seed.ts`, `src/services/palette.ts` and everything under `src/components/` are bundled for the browser: they must not import `node:*` modules or `dotenv`. Node-only helpers belong in `src/services/clip-paths.ts`, `image-gen.ts`, or the pipeline.
- Every new test file must be appended to the `test` script in `package.json`.
- Tests use `node:test` + `node:assert/strict` and make **no network calls** (stub `globalThis.fetch`).
- Commit after every task with a plain, imperative subject line.
- Log lines follow the existing shape: `[imagery] <scene id>: <what happened>`.

---

### Task 1: Scene schema and script prompt carry `imagePrompt`

**Files:**
- Modify: `src/types/video.ts` (add two fields to `videoSceneSchema`)
- Modify: `src/services/script-schema.ts` (`buildVideoPayloadJsonSchema`, `buildScriptPrompt`)
- Test: `src/services/script-schema.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `VideoScene.imagePrompt: string` (defaults to `""`) and `VideoScene.imageSrc?: string`. Both optional in input JSON, so existing payload files keep validating.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/script-schema.test.ts`:

```ts
test("the JSON schema asks each scene for an imagePrompt", () => {
  const schema = buildVideoPayloadJsonSchema(4) as any;
  const scene = schema.properties.scenes.items;
  assert.ok(scene.properties.imagePrompt, "imagePrompt is missing from the scene schema");
  assert.ok(scene.required.includes("imagePrompt"));
});

test("the prompt tells the model what an imagePrompt is for", () => {
  const prompt = buildScriptPrompt({ topic: "The Future of AI" });
  assert.match(prompt, /imagePrompt/);
});

test("a payload without imagePrompt still validates, defaulting to empty", () => {
  const payload = parseScriptJson(
    JSON.stringify({
      title: "T",
      fps: 30,
      aspectRatio: "9:16",
      scenes: [
        { id: "s1", text: "a", subtext: "b", narration: "n", durationInFrames: 90, themeColor: "#7c3aed", keywords: [] },
        { id: "s2", text: "a", subtext: "b", narration: "n", durationInFrames: 90, themeColor: "#7c3aed", keywords: [] },
        { id: "s3", text: "a", subtext: "b", narration: "n", durationInFrames: 90, themeColor: "#7c3aed", keywords: [] },
      ],
    })
  );
  assert.equal(payload.scenes[0].imagePrompt, "");
  assert.equal(payload.scenes[0].imageSrc, undefined);
});
```

Check the existing imports at the top of that file and add whichever of
`buildVideoPayloadJsonSchema`, `buildScriptPrompt`, `parseScriptJson` are not
already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/services/script-schema.test.ts`
Expected: FAIL — `imagePrompt is missing from the scene schema`.

- [ ] **Step 3: Add the schema fields**

In `src/types/video.ts`, inside `videoSceneSchema`, after `keywords`:

```ts
  // One sentence describing the picture for this scene. Written by the script
  // model; empty on hand-written payloads, where the imagery stage falls back
  // to keywords.
  imagePrompt: z.string().default(""),
  // Written by the imagery stage. Relative to public/, e.g. images/3f2a.jpg
  imageSrc: z.string().optional(),
```

- [ ] **Step 4: Ask the model for it**

In `src/services/script-schema.ts`, inside `buildVideoPayloadJsonSchema`, add to
the scene `properties` after `keywords`:

```ts
            imagePrompt: {
              type: "string",
              description: "One sentence describing what the viewer sees in this scene",
            },
```

and add `"imagePrompt"` to that scene's `required` array.

In `buildScriptPrompt`, insert these lines after the `narration` guidance lines
(before the `"Respond with JSON matching this schema:"` line):

```ts
    "Write `imagePrompt` for the camera: one concrete, filmable sentence describing a single",
    "image for that scene — subject, setting and lighting, no text or logos in the picture,",
    "no named real people.",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --test src/services/script-schema.test.ts`
Expected: PASS, all tests.

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/video.ts src/services/script-schema.ts src/services/script-schema.test.ts
git commit -m "Ask the script model for a per-scene image prompt"
```

---

### Task 2: Build the image prompt from a scene

**Files:**
- Create: `src/services/image-prompt.ts`
- Create: `src/services/image-prompt.test.ts`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Consumes: `VideoScene` from Task 1.
- Produces: `buildImagePrompt(scene: VideoScene): string` and the exported constant `IMAGE_STYLE_SUFFIX: string`. Pure, browser-safe, no Node imports.

- [ ] **Step 1: Write the failing test**

Create `src/services/image-prompt.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildImagePrompt, IMAGE_STYLE_SUFFIX } from "./image-prompt";
import type { VideoScene } from "../types/video";

const scene = (over: Partial<VideoScene> = {}): VideoScene => ({
  id: "scene-1",
  text: "Stoics slept early",
  subtext: "",
  narration: "",
  durationInFrames: 90,
  themeColor: "#7c3aed",
  keywords: ["marble statue", "dawn light"],
  imagePrompt: "",
  ...over,
});

test("prefers the model's imagePrompt", () => {
  const prompt = buildImagePrompt(scene({ imagePrompt: "A lone runner on a cold bridge at dawn" }));
  assert.match(prompt, /^A lone runner on a cold bridge at dawn/);
});

test("falls back to keywords when there is no imagePrompt", () => {
  assert.match(buildImagePrompt(scene()), /^marble statue, dawn light/);
});

test("falls back to the scene text when there are no keywords either", () => {
  assert.match(buildImagePrompt(scene({ keywords: [] })), /^Stoics slept early/);
});

test("always appends the shared style block", () => {
  assert.ok(buildImagePrompt(scene()).endsWith(IMAGE_STYLE_SUFFIX));
  assert.ok(buildImagePrompt(scene({ imagePrompt: "x" })).endsWith(IMAGE_STYLE_SUFFIX));
});

test("an empty scene still produces a usable prompt", () => {
  const prompt = buildImagePrompt(scene({ keywords: [], text: "", imagePrompt: "   " }));
  assert.ok(prompt.trim().length > 0);
  assert.ok(prompt.endsWith(IMAGE_STYLE_SUFFIX));
});

test("whitespace-only fields are treated as absent", () => {
  assert.match(buildImagePrompt(scene({ imagePrompt: "   " })), /^marble statue, dawn light/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/services/image-prompt.test.ts`
Expected: FAIL — cannot find module `./image-prompt`.

- [ ] **Step 3: Write the implementation**

Create `src/services/image-prompt.ts`:

```ts
import type { VideoScene } from "../types/video";

/**
 * Turns a scene into the text an image model is asked for.
 *
 * Pure and free of Node built-ins, so it can be imported from either side of
 * the render boundary.
 */

/** Appended to every prompt so all scenes of one video read as a single piece. */
export const IMAGE_STYLE_SUFFIX =
  ", cinematic still, dark moody palette, high contrast, shallow depth of field, " +
  "soft rim lighting, vertical 9:16 composition with empty space in the middle third, " +
  "no text, no logos, no watermark, no recognisable real people";

/** Used when a scene carries nothing to describe, so a render never asks for an empty picture. */
const FALLBACK_SUBJECT = "an abstract textured surface lit from one side";

function firstNonEmpty(...candidates: string[]): string {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return FALLBACK_SUBJECT;
}

export function buildImagePrompt(scene: VideoScene): string {
  const subject = firstNonEmpty(scene.imagePrompt, scene.keywords.join(", "), scene.text);

  return `${subject}${IMAGE_STYLE_SUFFIX}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/services/image-prompt.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Register the test file**

In `package.json`, append ` src/services/image-prompt.test.ts` to the end of the
`test` script's file list.

Run: `npm test`
Expected: the whole suite passes.

- [ ] **Step 6: Commit**

```bash
git add src/services/image-prompt.ts src/services/image-prompt.test.ts package.json
git commit -m "Build an image prompt from a scene"
```

---

### Task 3: Image cache paths

**Files:**
- Modify: `src/services/clip-paths.ts`
- Modify: `src/services/clip-paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `imageCacheKey(prompt: string, provider: string, model: string, width: number, height: number): string` (16 lowercase hex characters) and `imagePathFor(key: string): string` returning `images/<key>.jpg`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/clip-paths.test.ts`:

```ts
test("image cache key is stable and 16 hex characters", () => {
  const first = imageCacheKey("a cold bridge", "pollinations", "flux", 1080, 1920);
  const second = imageCacheKey("a cold bridge", "pollinations", "flux", 1080, 1920);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
});

test("image cache key changes with prompt, provider, model or size", () => {
  const base = imageCacheKey("a cold bridge", "pollinations", "flux", 1080, 1920);
  assert.notEqual(base, imageCacheKey("a warm bridge", "pollinations", "flux", 1080, 1920));
  assert.notEqual(base, imageCacheKey("a cold bridge", "together", "flux", 1080, 1920));
  assert.notEqual(base, imageCacheKey("a cold bridge", "pollinations", "other", 1080, 1920));
  assert.notEqual(base, imageCacheKey("a cold bridge", "pollinations", "flux", 768, 1344));
});

test("image path lives under images/ and never collides with audio", () => {
  assert.equal(imagePathFor("abc123"), "images/abc123.jpg");
  assert.notEqual(imagePathFor("abc123"), clipPathFor("abc123"));
});
```

Add `imageCacheKey` and `imagePathFor` to the existing import from
`./clip-paths` at the top of the file (`clipPathFor` is already imported there;
if it is not, add it too).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/services/clip-paths.test.ts`
Expected: FAIL — `imageCacheKey is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/services/clip-paths.ts`:

```ts
/**
 * Identifies a generated image by everything that determines what it looks
 * like, so changing the provider, the model or the frame size produces a new
 * file instead of silently reusing the old one.
 */
export function imageCacheKey(
  prompt: string,
  provider: string,
  model: string,
  width: number,
  height: number
): string {
  return crypto
    .createHash("sha256")
    .update(`${prompt} ${provider} ${model} ${width}x${height}`)
    .digest("hex")
    .slice(0, 16);
}

/** Image path (relative to public/) for a given cache key, e.g. images/3f2a1b0c....jpg */
export function imagePathFor(key: string): string {
  return `images/${key}.jpg`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/services/clip-paths.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/clip-paths.ts src/services/clip-paths.test.ts
git commit -m "Name and key the generated image cache"
```

---

### Task 4: Image generation providers

**Files:**
- Create: `src/services/image-gen.ts`
- Create: `src/services/image-gen.test.ts`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type ImageProvider = "pollinations" | "together" | "none"`
  - `type ImageConfig = { provider: ImageProvider; model: string; apiKey?: string; width: number; height: number }`
  - `resolveImageConfig(env?: NodeJS.ProcessEnv): ImageConfig` — throws on an unknown provider, and on `together` without `IMAGE_API_KEY`.
  - `describeImageError(provider: string, status: number, body: string): Error`
  - `generateImage(prompt: string, seed: number, config?: ImageConfig): Promise<Buffer>`
  - Constants `defaultImageProvider`, `defaultPollinationsModel`, `defaultTogetherModel`.

- [ ] **Step 1: Write the failing tests**

Create `src/services/image-gen.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultPollinationsModel,
  defaultTogetherModel,
  describeImageError,
  generateImage,
  resolveImageConfig,
} from "./image-gen";

test("defaults to the keyless provider", () => {
  const config = resolveImageConfig({});
  assert.equal(config.provider, "pollinations");
  assert.equal(config.model, defaultPollinationsModel);
  assert.equal(config.apiKey, undefined);
  assert.equal(config.width, 1080);
  assert.equal(config.height, 1920);
});

test("together needs a key and uses its own default model and size", () => {
  assert.throws(() => resolveImageConfig({ IMAGE_PROVIDER: "together" }), /IMAGE_API_KEY/);

  const config = resolveImageConfig({ IMAGE_PROVIDER: "together", IMAGE_API_KEY: "k" });
  assert.equal(config.model, defaultTogetherModel);
  assert.equal(config.width % 16, 0);
  assert.equal(config.height % 16, 0);
});

test("IMAGE_MODEL overrides the provider default", () => {
  assert.equal(resolveImageConfig({ IMAGE_MODEL: "turbo" }).model, "turbo");
});

test("none is a valid provider", () => {
  assert.equal(resolveImageConfig({ IMAGE_PROVIDER: "none" }).provider, "none");
});

test("an unknown provider names the valid ones", () => {
  assert.throws(() => resolveImageConfig({ IMAGE_PROVIDER: "midjourney" }), /pollinations/);
});

test("error messages say what to do next", () => {
  assert.match(describeImageError("together", 401, "nope").message, /IMAGE_API_KEY/);
  assert.match(describeImageError("pollinations", 429, "slow down").message, /rate limit/i);
  assert.match(describeImageError("pollinations", 500, "boom").message, /500/);
});

async function withFetch(stub: typeof globalThis.fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;

  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("pollinations asks for the image over GET and returns the bytes", async () => {
  let seen = "";

  await withFetch(
    (async (input: any) => {
      seen = String(input);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof globalThis.fetch,
    async () => {
      const bytes = await generateImage("a cold bridge", 42, resolveImageConfig({}));
      assert.deepEqual([...bytes], [1, 2, 3]);
      assert.match(seen, /^https:\/\/image\.pollinations\.ai\/prompt\/a%20cold%20bridge\?/);
      assert.match(seen, /width=1080&height=1920/);
      assert.match(seen, /seed=42/);
    }
  );
});

test("together posts and decodes the base64 image", async () => {
  await withFetch(
    (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("hi").toString("base64") }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch,
    async () => {
      const config = resolveImageConfig({ IMAGE_PROVIDER: "together", IMAGE_API_KEY: "k" });
      const bytes = await generateImage("a cold bridge", 7, config);
      assert.equal(bytes.toString("utf8"), "hi");
    }
  );
});

test("a failed request throws a provider-specific error", async () => {
  await withFetch(
    (async () => new Response("boom", { status: 500 })) as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => generateImage("x", 1, resolveImageConfig({})), /pollinations/);
    }
  );
});

test("an empty body is an error, not an empty image", async () => {
  await withFetch(
    (async () => new Response(new Uint8Array([]), { status: 200 })) as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => generateImage("x", 1, resolveImageConfig({})), /empty/i);
    }
  );
});

test("generating with the none provider is a programming error", async () => {
  await assert.rejects(
    () => generateImage("x", 1, resolveImageConfig({ IMAGE_PROVIDER: "none" })),
    /none/
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/services/image-gen.test.ts`
Expected: FAIL — cannot find module `./image-gen`.

- [ ] **Step 3: Write the implementation**

Create `src/services/image-gen.ts`:

```ts
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

/** Half a minute is long for an image and short enough not to stall a render. */
const REQUEST_TIMEOUT_MS = 60_000;

export const defaultImageProvider = "pollinations";
export const defaultPollinationsModel = "flux";
export const defaultTogetherModel = "black-forest-labs/FLUX.1-schnell-Free";

/** The frame is 1080x1920. FLUX needs multiples of 16, so together renders smaller and is scaled up by `cover`. */
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

  const bytes =
    config.provider === "pollinations"
      ? await generateWithPollinations(prompt, seed, config)
      : await generateWithTogether(prompt, seed, config);

  if (bytes.byteLength === 0) {
    throw new Error(`Image generation returned an empty body from ${config.provider}`);
  }

  return bytes;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/services/image-gen.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Register the test file**

Append ` src/services/image-gen.test.ts` to the `test` script in `package.json`.

Run: `npm test` and `npm run build`
Expected: suite passes, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/image-gen.ts src/services/image-gen.test.ts package.json
git commit -m "Generate stills through a free image provider seam"
```

---

### Task 5: The imagery pipeline stage

**Files:**
- Create: `src/pipeline/imagery.ts`
- Create: `src/pipeline/imagery.test.ts`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Consumes: `buildImagePrompt` (Task 2), `imageCacheKey`/`imagePathFor` (Task 3), `resolveImageConfig`/`generateImage`/`ImageConfig` (Task 4), `seedFromId` from `../services/seed`.
- Produces:
  - `planSceneImage(scene: VideoScene, config: ImageConfig): { prompt: string; key: string; relPath: string; seed: number }` — the pure decision half, unit-tested.
  - `attachImagery(payload: VideoPayload): Promise<VideoPayload>` — the fs/network half, called by the render pipeline.

- [ ] **Step 1: Write the failing tests**

Create `src/pipeline/imagery.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { planSceneImage, attachImagery } from "./imagery";
import { resolveImageConfig } from "../services/image-gen";
import type { VideoPayload, VideoScene } from "../types/video";

const scene = (over: Partial<VideoScene> = {}): VideoScene => ({
  id: "scene-1",
  text: "Stoics slept early",
  subtext: "",
  narration: "",
  durationInFrames: 90,
  themeColor: "#7c3aed",
  keywords: ["marble statue"],
  imagePrompt: "A lone runner on a cold bridge at dawn",
  ...over,
});

const payload = (scenes: VideoScene[]): VideoPayload => ({
  title: "T",
  fps: 30,
  aspectRatio: "9:16",
  scenes,
});

test("the plan carries the prompt, a cache path and a scene-derived seed", () => {
  const plan = planSceneImage(scene(), resolveImageConfig({}));
  assert.match(plan.prompt, /^A lone runner on a cold bridge at dawn/);
  assert.equal(plan.relPath, `images/${plan.key}.jpg`);
  assert.equal(plan.seed, planSceneImage(scene(), resolveImageConfig({})).seed);
});

test("two scenes with the same prompt share one cached file", () => {
  const config = resolveImageConfig({});
  const first = planSceneImage(scene({ id: "a" }), config);
  const second = planSceneImage(scene({ id: "b" }), config);
  assert.equal(first.relPath, second.relPath);
});

test("different scenes get different seeds", () => {
  const config = resolveImageConfig({});
  assert.notEqual(planSceneImage(scene({ id: "a" }), config).seed, planSceneImage(scene({ id: "b" }), config).seed);
});

test("the none provider leaves every scene untouched and makes no request", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("no request should be made");
  }) as typeof globalThis.fetch;

  try {
    process.env.IMAGE_PROVIDER = "none";
    const result = await attachImagery(payload([scene()]));
    assert.equal(result.scenes[0].imageSrc, undefined);
  } finally {
    delete process.env.IMAGE_PROVIDER;
    globalThis.fetch = original;
  }
});

test("a provider failure falls back instead of throwing", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof globalThis.fetch;

  try {
    process.env.IMAGE_PROVIDER = "pollinations";
    const result = await attachImagery(payload([scene({ imagePrompt: `fallback probe ${Date.now()}` })]));
    assert.equal(result.scenes[0].imageSrc, undefined);
    assert.equal(result.scenes.length, 1);
  } finally {
    delete process.env.IMAGE_PROVIDER;
    globalThis.fetch = original;
  }
});

test("a bad configuration falls back for the whole payload", async () => {
  try {
    process.env.IMAGE_PROVIDER = "midjourney";
    const result = await attachImagery(payload([scene()]));
    assert.equal(result.scenes[0].imageSrc, undefined);
  } finally {
    delete process.env.IMAGE_PROVIDER;
  }
});

test("a generated image is written and stamped onto the scene", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })) as typeof globalThis.fetch;

  try {
    process.env.IMAGE_PROVIDER = "pollinations";
    const unique = `a unique probe subject ${Date.now()}`;
    const result = await attachImagery(payload([scene({ imagePrompt: unique })]));
    assert.match(String(result.scenes[0].imageSrc), /^images\/[0-9a-f]{16}\.jpg$/);
  } finally {
    delete process.env.IMAGE_PROVIDER;
    globalThis.fetch = original;
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/pipeline/imagery.test.ts`
Expected: FAIL — cannot find module `./imagery`.

- [ ] **Step 3: Write the implementation**

Create `src/pipeline/imagery.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImagePrompt } from "../services/image-prompt";
import { imageCacheKey, imagePathFor } from "../services/clip-paths";
import { generateImage, resolveImageConfig, type ImageConfig } from "../services/image-gen";
import { seedFromId } from "../services/seed";
import type { VideoPayload, VideoScene } from "../types/video";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const publicDir = path.join(rootDir, "public");

/**
 * The decision half of the stage: what to ask for, where it is cached, and
 * which seed draws it. Pure, so it can be tested without fs or network.
 *
 * The key deliberately excludes the scene id: two scenes asking for the same
 * picture should share one file. The seed does depend on the id, so scenes
 * that ask for different pictures never collide.
 */
export function planSceneImage(scene: VideoScene, config: ImageConfig) {
  const prompt = buildImagePrompt(scene);
  const key = imageCacheKey(prompt, config.provider, config.model, config.width, config.height);

  return { prompt, key, relPath: imagePathFor(key), seed: seedFromId(scene.id) };
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates one background image per scene and stamps its path onto the scene.
 * Returns a new payload; the input is not mutated.
 *
 * Every failure path is a fallback, never a throw: a scene without `imageSrc`
 * simply renders the aurora background, so imagery can never fail a render.
 */
export async function attachImagery(payload: VideoPayload): Promise<VideoPayload> {
  let config: ImageConfig;

  try {
    config = resolveImageConfig();
  } catch (error) {
    console.warn(`[imagery] disabled: ${error instanceof Error ? error.message : String(error)}`);
    return payload;
  }

  if (config.provider === "none") {
    console.log("[imagery] provider is none, keeping the generated background");
    return payload;
  }

  await fs.mkdir(path.join(publicDir, "images"), { recursive: true });

  const scenes: VideoScene[] = [];

  for (const scene of payload.scenes) {
    const { prompt, relPath, seed } = planSceneImage(scene, config);
    const file = path.join(publicDir, relPath);

    if (await exists(file)) {
      console.log(`[imagery] ${scene.id}: cached`);
      scenes.push({ ...scene, imageSrc: relPath });
      continue;
    }

    console.log(`[imagery] ${scene.id}: generating`);

    try {
      const bytes = await generateImage(prompt, seed, config);
      await fs.writeFile(file, bytes);
      scenes.push({ ...scene, imageSrc: relPath });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[imagery] ${scene.id}: falling back (${reason})`);
      const { imageSrc: _stale, ...rest } = scene;
      scenes.push(rest);
    }
  }

  return { ...payload, scenes };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/pipeline/imagery.test.ts`
Expected: PASS, all tests.

Then remove the probe files the test wrote so they are never committed:

```bash
git status --short public/images
```

Expected: nothing tracked (Task 6 adds the ignore rule; if files are listed
there, delete them with `rm public/images/*.jpg` before committing).

- [ ] **Step 5: Register the test file**

Append ` src/pipeline/imagery.test.ts` to the `test` script in `package.json`.

Run: `npm test` and `npm run build`
Expected: suite passes, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/imagery.ts src/pipeline/imagery.test.ts package.json
git commit -m "Add the imagery pipeline stage with a silent fallback"
```

---

### Task 6: Wire the stage into the render, the CLI and the environment

**Files:**
- Modify: `src/services/cli-args.ts`
- Modify: `src/services/cli-args.test.ts`
- Modify: `src/pipeline/render.ts:26-33` (the `renderVideo` signature and the stage chain) and its `run()` block
- Modify: `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `attachImagery` (Task 5).
- Produces: `parseArgs(...)` gains `images: boolean`; `renderVideo(brief, payloadOverride?, options: { audio?: boolean; images?: boolean })`.

- [ ] **Step 1: Write the failing test**

Append to `src/services/cli-args.test.ts`:

```ts
test("images are on by default and off with --no-images", () => {
  assert.equal(parseArgs(["--topic", "x"]).images, true);
  assert.equal(parseArgs(["--topic", "x", "--no-images"]).images, false);
});

test("--no-images is not swallowed into the topic", () => {
  assert.equal(parseArgs(["The", "Future", "--no-images"]).topic, "The Future");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/services/cli-args.test.ts`
Expected: FAIL — `images` is `undefined`.

- [ ] **Step 3: Parse the flag**

In `src/services/cli-args.ts`, change the positional filter so it also drops the
new flag, and return it:

```ts
  const positional = argv
    .filter((arg, i) => !consumedIndices.has(i) && arg !== "--no-audio" && arg !== "--no-images" && arg !== "--")
    .join(" ")
    .trim();

  return {
    payloadFile,
    topic: topicFlag ?? positional,
    niche,
    sceneCount,
    audio: !argv.includes("--no-audio"),
    images: !argv.includes("--no-images"),
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/services/cli-args.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Run the stage in the pipeline**

In `src/pipeline/render.ts`, import the stage beside the others:

```ts
import { attachImagery } from "./imagery";
```

and replace the signature and the payload line:

```ts
export async function renderVideo(
  brief: ScriptBrief,
  payloadOverride?: VideoPayload,
  options: { audio?: boolean; images?: boolean } = {},
) {
  const script = payloadOverride ?? (await generateScript(brief));
  const spoken =
    options.audio === false ? script : await attachCaptions(await attachVoiceover(script));
  const payload = options.images === false ? spoken : await attachImagery(spoken);
```

In the `run()` block, read the flag and pass it through both call sites:

```ts
    const { topic, niche, sceneCount, payloadFile, audio, images } = parseArgs(process.argv.slice(2));
```

```ts
      const result = await renderVideo(brief, payload, { audio, images });
```

```ts
    const result = await renderVideo(brief, undefined, { audio, images });
```

- [ ] **Step 6: Document the environment and ignore the cache**

Append to `.env.example`:

```
# Scene imagery. pollinations (keyless, default) | together | none
IMAGE_PROVIDER=pollinations
IMAGE_API_KEY=
IMAGE_MODEL=
```

Add `public/images/` to `.gitignore`, on the line after the existing
`public/audio/` entry:

```
public/audio/
public/images/
```

- [ ] **Step 7: Verify end to end without a network call**

Run: `npm run build`
Expected: no TypeScript errors.

Run: `npm test`
Expected: the whole suite passes.

Run: `node run.mjs --payload scripts/example-payload.json --no-audio --no-images`
Expected: the render completes and writes an MP4 under `out/`, with no
`[imagery]` lines in the output.

- [ ] **Step 8: Commit**

```bash
git add src/services/cli-args.ts src/services/cli-args.test.ts src/pipeline/render.ts .env.example .gitignore
git commit -m "Run the imagery stage from the render pipeline"
```

---

### Task 7: Draw the image behind the scene

**Files:**
- Modify: `src/components/Background.tsx`
- Modify: `src/components/Scene.tsx:26-30` (the `<Background />` call)

**Interfaces:**
- Consumes: `VideoScene.imageSrc` (Task 1), written by Task 5.
- Produces: `Background` accepts an optional `imageSrc?: string` prop. No other component's interface changes.

- [ ] **Step 1: Add the image branch to the background**

In `src/components/Background.tsx`, add `Img` and `staticFile` to the existing
`remotion` import, add the prop, and add the constants beside the other tuned
constants:

```ts
/**
 * The image is scaled past the frame over the scene so it never sits still.
 * Kept small on purpose: a stronger zoom pulls the eye off the caption.
 */
const IMAGE_ZOOM_GROWTH = 0.08;

/**
 * How hard the picture is pushed down so white text stays readable on it.
 * Heavier at the top and bottom, where the keyword badge and the captions sit.
 */
const IMAGE_SCRIM =
  "linear-gradient(to bottom, rgba(2, 4, 9, 0.78) 0%, rgba(2, 4, 9, 0.5) 38%, " +
  "rgba(2, 4, 9, 0.55) 62%, rgba(2, 4, 9, 0.85) 100%)";
```

```ts
type BackgroundProps = {
  themeColor: string;
  sceneId: string;
  durationInFrames: number;
  // Relative to public/, written by the imagery stage. Absent scenes fall back
  // to the drawn aurora, which is what every scene used before imagery existed.
  imageSrc?: string;
};
```

Destructure `imageSrc` in the component signature, and return the image branch
before the aurora one — after `progress` and `grainShift` are computed, since
the image branch reuses both:

```tsx
  if (imageSrc) {
    return (
      <AbsoluteFill style={{ backgroundColor: BASE_COLOR, overflow: "hidden" }}>
        <Img
          src={staticFile(imageSrc)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${1 + progress * IMAGE_ZOOM_GROWTH})`,
          }}
        />

        <div style={{ position: "absolute", inset: 0, background: IMAGE_SCRIM }} />

        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: GRAIN,
            backgroundPosition: `${grainShift}px ${grainShift}px`,
            opacity: GRAIN_LAYER_OPACITY,
            mixBlendMode: "overlay",
          }}
        />

        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 35%, rgba(2, 4, 9, 0.6) 100%)",
          }}
        />
      </AbsoluteFill>
    );
  }
```

Leave the aurora return exactly as it is. `width`, `height` and `seed` are only
used by the aurora branch; leave those lines where they are.

- [ ] **Step 2: Pass the scene's image down**

In `src/components/Scene.tsx`:

```tsx
      <Background
        themeColor={scene.themeColor}
        sceneId={scene.id}
        durationInFrames={scene.durationInFrames}
        imageSrc={scene.imageSrc}
      />
```

- [ ] **Step 3: Verify the types and the aurora path still render**

Run: `npm run build`
Expected: no TypeScript errors.

Run: `npm run test:render`
Expected: the offline smoke render completes and writes an MP4 under `out/`.

- [ ] **Step 4: Verify the image path renders**

Run: `node run.mjs --payload scripts/example-payload.json --no-audio`
Expected: `[imagery] <scene id>: generating` (or `cached`) for each scene, files
appear under `public/images/`, and the render completes.

Open the resulting MP4 and confirm: the picture fills the frame, the headline
and the keyword badge are legible over it, and the image drifts slowly rather
than sitting still. If the text is hard to read, raise the middle stops of
`IMAGE_SCRIM` (0.5/0.55) together and re-check against the rendered file, not
in isolation.

- [ ] **Step 5: Commit**

```bash
git add src/components/Background.tsx src/components/Scene.tsx
git commit -m "Render the generated still as the scene background"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md` (the `How it works`, `CLI`, `Configuration`, `Caching` and `Failure behaviour` sections)
- Modify: `roadmap.md` (append Phase 12)

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Update the README**

Make these edits, matching the surrounding wording and depth:

- `How it works`: add imagery as the stage after captions — one generated still per scene, written to `public/images/`, drawn full-frame under a darkening scrim with a slow zoom, falling back to the drawn aurora background.
- `CLI`: document `--no-images` beside `--no-audio`.
- `Configuration`: document `IMAGE_PROVIDER` (`pollinations` keyless default, `together`, `none`), `IMAGE_API_KEY` (only for `together`) and `IMAGE_MODEL`.
- `Caching`: images are keyed by prompt, provider, model and size under
  `public/images/`, so an unchanged prompt is never regenerated.
- `Failure behaviour`: an image that cannot be generated logs one line and
  leaves that scene on the aurora background; the render still succeeds.

- [ ] **Step 2: Append the roadmap phase**

Add to the end of `roadmap.md`:

```markdown
---

### Phase 12: Generated Scene Imagery
- [x] Ask the script model for a per-scene `imagePrompt`, falling back to `keywords`.
- [x] Generate one still per scene through a free provider seam: `pollinations` (keyless default), `together`, `none`.
- [x] Cache images by prompt, provider, model and size under `public/images/`.
- [x] Draw the still full-frame under a darkening scrim with a slow zoom, keeping the grain and vignette.
- [x] Fall back to the aurora background on any failure, so imagery never fails a render.
- [x] Support `--no-images` for renders with no image calls.
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: the whole suite passes.

- [ ] **Step 4: Commit**

```bash
git add README.md roadmap.md
git commit -m "Document generated scene imagery"
```

---

## Verification checklist

Before opening the PR:

- `npm run build` — clean.
- `npm test` — all suites pass.
- `node run.mjs --payload scripts/example-payload.json --no-audio` — renders with images.
- `node run.mjs --payload scripts/example-payload.json --no-audio --no-images` — renders with the aurora background.
- `git status --short` — no generated images or MP4s staged.
