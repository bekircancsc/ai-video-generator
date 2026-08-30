# Voiceover Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every rendered scene a spoken narration whose measured length determines how long the scene stays on screen.

**Architecture:** Voiceover is a pipeline stage that runs after script generation and before Remotion bundling. It synthesizes one WAV per scene into `public/audio/`, measures each clip by reading its RIFF header, rewrites `durationInFrames` from that measurement, and stamps an `audioSrc` onto the scene. Remotion then plays the clip as an ordinary static asset, so the React side stays declarative and knows nothing about synthesis.

**Tech Stack:** Node 22, TypeScript, tsx, Remotion 4, Zod 4, Groq `canopylabs/orpheus-v1-english` over `fetch`. Tests use the built-in `node:test` runner. This plan adds no npm dependencies.

## Global Constraints

- Narration language is English.
- TTS provider is Groq, reusing the existing `LLM_API_KEY`. Do not introduce a second key.
- Add no npm dependencies. Duration measurement reads the WAV header directly.
- Valid Groq voices, exact list: `autumn`, `diana`, `hannah`, `austin`, `daniel`, `troy`.
- Groq speech output is RIFF/WAVE, 24000 Hz, mono, 16-bit.
- Timing constants, exact values: lead-in `0.25`s, tail `0.5`s, floor `45` frames.
- Cache filename is the first 16 hex characters of `sha256(narration + voice + model)`.
- `audioSrc` is a path relative to `public/`, e.g. `audio/3f2a1b....wav`.
- A TTS failure aborts the render. Never silently produce a silent video.
- `--no-audio` skips synthesis entirely: no network calls, no `audioSrc`, and every scene keeps the `durationInFrames` the model produced.
- **Nothing under `src/components/`, `src/Root.tsx`, or `src/VideoRoot.tsx` may import a module that touches `node:fs`, `node:crypto`, or `dotenv`.** Those files are bundled for the browser by Remotion, and a Node built-in reaching that bundle breaks it. This is why timing constants live in their own dependency-free module.

## File Structure

| Path | Responsibility |
|---|---|
| `src/services/audio-duration.ts` | Create. Pure RIFF/WAVE header parsing and duration maths. |
| `src/services/audio-duration.test.ts` | Create. Unit tests for the parser, no network. |
| `src/services/timing.ts` | Create. Pure timing policy. Safe to import from browser-bundled code. |
| `src/services/timing.test.ts` | Create. Unit tests for the frame calculation. |
| `src/services/tts.ts` | Create. Groq speech synthesis and its error mapping. |
| `src/services/tts.test.ts` | Create. Unit tests for the pure error mapper and config resolution. |
| `src/pipeline/voiceover.ts` | Create. Per-scene orchestration: synthesize, cache, measure, retime. |
| `src/pipeline/voiceover.test.ts` | Create. Unit tests for the cache key. |
| `src/types/video.ts` | Modify. Add `narration` and `audioSrc` to the scene schema. |
| `src/services/script-schema.ts` | Modify. Add `narration` to the JSON schema and the prompt. |
| `src/components/Scene.tsx` | Modify. Play `audioSrc` when present. |
| `src/pipeline/render.ts` | Modify. Run the voiceover stage; support `--no-audio`. |
| `src/pipeline/test-render.ts` | Modify. Add narration; keep the smoke test offline. |
| `src/Root.tsx` | Modify. Add narration to `defaultProps`. |
| `scripts/example-payload.json` | Modify. Add narration to each scene. |
| `package.json` | Modify. Add the `test` script. |
| `.gitignore` | Modify. Ignore `public/audio/`. |
| `.env.example` | Modify. Document the TTS variables. |
| `roadmap.md` | Modify. Record the phase. |

---

### Task 1: WAV duration measurement

Pure functions, no network and no filesystem. Everything downstream depends on these being correct, so they come first.

**Files:**
- Create: `src/services/audio-duration.ts`
- Test: `src/services/audio-duration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type WavFormat = { sampleRate: number; channels: number; bitsPerSample: number; dataBytes: number }`
  - `parseWavHeader(buffer: Buffer): WavFormat`
  - `getWavDurationSeconds(buffer: Buffer): number`

- [ ] **Step 1: Write the failing test**

Create `src/services/audio-duration.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { getWavDurationSeconds, parseWavHeader } from "./audio-duration";

/**
 * Builds a minimal RIFF/WAVE buffer.
 * `extraChunk` inserts a junk chunk before `data`, which real encoders do and
 * which a parser assuming a fixed 44-byte header would get wrong.
 */
function buildWav(options: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  extraChunk?: boolean;
}) {
  const { sampleRate, channels, bitsPerSample, dataBytes, extraChunk = false } = options;

  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 16);
  fmt.writeUInt16LE((channels * bitsPerSample) / 8, 20);
  fmt.writeUInt16LE(bitsPerSample, 22);

  const extra = Buffer.alloc(12);
  extra.write("LIST", 0, "ascii");
  extra.writeUInt32LE(4, 4);
  extra.write("INFO", 8, "ascii");

  const data = Buffer.alloc(8 + dataBytes);
  data.write("data", 0, "ascii");
  data.writeUInt32LE(dataBytes, 4);

  const body = Buffer.concat(extraChunk ? [fmt, extra, data] : [fmt, data]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + body.length, 4);
  header.write("WAVE", 8, "ascii");

  return Buffer.concat([header, body]);
}

test("parses format fields from a standard header", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 48000 });
  assert.deepEqual(parseWavHeader(wav), {
    sampleRate: 24000,
    channels: 1,
    bitsPerSample: 16,
    dataBytes: 48000,
  });
});

test("measures duration of Groq's 24kHz mono 16-bit output", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 48000 });
  assert.equal(getWavDurationSeconds(wav), 1);
});

test("skips unknown chunks placed before data", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 24000, extraChunk: true });
  assert.equal(getWavDurationSeconds(wav), 0.5);
});

test("handles stereo and higher bit depth", () => {
  const wav = buildWav({ sampleRate: 48000, channels: 2, bitsPerSample: 24, dataBytes: 48000 * 2 * 3 });
  assert.equal(getWavDurationSeconds(wav), 1);
});

test("clamps a data size that overruns the buffer", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 24000 });
  // Overwrite the data chunk's declared size with a value larger than the file.
  wav.writeUInt32LE(999999, wav.length - 24000 - 4);
  assert.equal(getWavDurationSeconds(wav), 0.5);
});

test("rejects a buffer that is not RIFF/WAVE", () => {
  assert.throws(() => parseWavHeader(Buffer.from("definitely not audio")), /RIFF\/WAVE/);
});

test("rejects a WAVE file with no data chunk", () => {
  const wav = buildWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 0 });
  const truncated = wav.subarray(0, wav.length - 8);
  assert.throws(() => parseWavHeader(truncated), /data chunk/);
});
```

- [ ] **Step 2: Add the test script**

In `package.json`, add this entry to `"scripts"`:

```json
"test": "node --import tsx --test src/services/audio-duration.test.ts"
```

The runner takes an explicit file list rather than a glob, because npm scripts run through `cmd.exe` on Windows and globs are not expanded there. Later tasks append their files to this list.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module './audio-duration'`.

- [ ] **Step 4: Write the implementation**

Create `src/services/audio-duration.ts`:

```ts
export type WavFormat = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
};

/**
 * Reads the format and data chunks out of a RIFF/WAVE buffer.
 * Chunks are walked rather than assuming the common 44-byte header, because
 * encoders are free to emit metadata chunks before the audio data.
 */
export function parseWavHeader(buffer: Buffer): WavFormat {
  const isRiffWave =
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE";

  if (!isRiffWave) {
    throw new Error("Audio is not a RIFF/WAVE file");
  }

  let format: Omit<WavFormat, "dataBytes"> | undefined;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (chunkId === "fmt " && body + 16 <= buffer.length) {
      format = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    }

    if (chunkId === "data") {
      if (!format) {
        throw new Error("WAVE data chunk appeared before its fmt chunk");
      }

      return {
        ...format,
        // A truncated download can declare more bytes than it actually carries.
        dataBytes: Math.min(chunkSize, buffer.length - body),
      };
    }

    // Chunks are word aligned, so an odd size carries a trailing pad byte.
    offset = body + chunkSize + (chunkSize % 2);
  }

  throw new Error("WAVE file contains no data chunk");
}

/** Duration in seconds of a RIFF/WAVE buffer. */
export function getWavDurationSeconds(buffer: Buffer): number {
  const { sampleRate, channels, bitsPerSample, dataBytes } = parseWavHeader(buffer);
  const bytesPerFrame = channels * (bitsPerSample / 8);

  if (sampleRate <= 0 || bytesPerFrame <= 0) {
    throw new Error("WAVE file declares an unusable sample rate or frame size");
  }

  return dataBytes / (sampleRate * bytesPerFrame);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 7 tests.

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/services/audio-duration.ts src/services/audio-duration.test.ts package.json
git commit -m "Add WAV duration measurement"
```

---

### Task 2: Timing policy

A separate module from the start, because `Scene.tsx` needs the lead-in constant and `Scene.tsx` is bundled for the browser. Keeping this file free of Node built-ins is what lets both sides import it.

**Files:**
- Create: `src/services/timing.ts`
- Test: `src/services/timing.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LEAD_IN_SECONDS: number` (0.25)
  - `TAIL_SECONDS: number` (0.5)
  - `MIN_SCENE_FRAMES: number` (45)
  - `computeSceneFrames(speechSeconds: number, fps: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/services/timing.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { LEAD_IN_SECONDS, MIN_SCENE_FRAMES, TAIL_SECONDS, computeSceneFrames } from "./timing";

test("pads speech with a lead-in and a tail", () => {
  assert.equal(computeSceneFrames(6, 30), Math.ceil((6 + LEAD_IN_SECONDS + TAIL_SECONDS) * 30));
  assert.equal(computeSceneFrames(6, 30), 203);
});

test("rounds up so the tail is never clipped", () => {
  assert.equal(computeSceneFrames(1.001, 30), 53);
});

test("applies a floor so a very short line still holds the screen", () => {
  assert.equal(computeSceneFrames(0.1, 30), MIN_SCENE_FRAMES);
});

test("respects a non-default frame rate", () => {
  assert.equal(computeSceneFrames(2, 60), 165);
});
```

- [ ] **Step 2: Extend the test script**

In `package.json`, change the `test` script to:

```json
"test": "node --import tsx --test src/services/audio-duration.test.ts src/services/timing.test.ts"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module './timing'`.

- [ ] **Step 4: Write the implementation**

Create `src/services/timing.ts`:

```ts
/**
 * Timing policy shared by the voiceover pipeline and the Remotion components.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

/** Silence before the first word, so speech never starts on frame zero. */
export const LEAD_IN_SECONDS = 0.25;

/** Silence after the last word, so the cut does not clip the final syllable. */
export const TAIL_SECONDS = 0.5;

/** Shortest a scene may run, so a very short line still stays readable. */
export const MIN_SCENE_FRAMES = 45;

/** How long a scene must run to carry its narration comfortably. */
export function computeSceneFrames(speechSeconds: number, fps: number): number {
  const padded = LEAD_IN_SECONDS + speechSeconds + TAIL_SECONDS;
  return Math.max(MIN_SCENE_FRAMES, Math.ceil(padded * fps));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/timing.ts src/services/timing.test.ts package.json
git commit -m "Add scene timing policy"
```

---

### Task 3: Narration in the schema and the prompt

The scene schema gains its two new fields before anything writes them, so every later task typechecks against the final shape.

**Files:**
- Modify: `src/types/video.ts`
- Modify: `src/services/script-schema.ts`
- Modify: `src/Root.tsx`
- Modify: `src/pipeline/test-render.ts`
- Modify: `scripts/example-payload.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `VideoScene` gains `narration: string` (defaults to `""`) and `audioSrc?: string`.

- [ ] **Step 1: Add the fields to the Zod scene schema**

In `src/types/video.ts`, replace the whole `videoSceneSchema` definition with:

```ts
export const videoSceneSchema = z.object({
  id: z.string(),
  text: z.string(),
  subtext: z.string().default(""),
  narration: z.string().default(""),
  durationInFrames: z.number().int().positive(),
  themeColor: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#6d5df6"),
  keywords: z.array(z.string()).default([]),
  // Written by the voiceover stage. Relative to public/, e.g. audio/3f2a.wav
  audioSrc: z.string().optional(),
});
```

`narration` defaults to an empty string so any payload file written before this change still validates.

- [ ] **Step 2: Add narration to the JSON schema sent to the model**

In `src/services/script-schema.ts`, inside `videoPayloadJsonSchema.properties.scenes.items.properties`, add a `narration` entry immediately after `subtext`:

```ts
          subtext: { type: "string" },
          narration: { type: "string", description: "What the voiceover says for this scene" },
```

Then add `"narration"` to that same object's `required` array so it reads:

```ts
        required: ["id", "text", "subtext", "narration", "durationInFrames", "themeColor", "keywords"],
```

- [ ] **Step 3: Tell the model what narration is for**

In `src/services/script-schema.ts`, replace the whole `buildScriptPrompt` function with:

```ts
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
```

- [ ] **Step 4: Add narration to the Remotion default props**

In `src/Root.tsx`, add a `narration` line to each of the three scenes in `defaultVideo`, directly beneath each `subtext` line.

Scene 1:

```ts
      narration: "Artificial intelligence is moving faster than anyone predicted, and the pace is still climbing.",
```

Scene 2:

```ts
      narration: "Ideas that used to sit in a notebook now turn into working tools in a single afternoon.",
```

Scene 3:

```ts
      narration: "The real advantage is not the machine alone. It is what people build with it.",
```

- [ ] **Step 5: Add narration to the offline mock payload**

In `src/pipeline/test-render.ts`, add a `narration` line to each of the three scenes in `mockPayload`, directly beneath each `subtext` line.

Scene 1:

```ts
      narration: "This is the first scene of the offline render smoke test.",
```

Scene 2:

```ts
      narration: "Frame cadence and transitions are being checked here.",
```

Scene 3:

```ts
      narration: "The final asset is ready for review.",
```

- [ ] **Step 6: Add narration to the example payload**

In `scripts/example-payload.json`, add a `"narration"` key to each scene, directly beneath each `"subtext"` line.

Scene 1:

```json
      "narration": "Artificial intelligence just rewrote the rules. What took a studio a week now takes one prompt.",
```

Scene 2:

```json
      "narration": "The gap is closing fast. Tools that were research demos last year are shipping every single day.",
```

Scene 3:

```json
      "narration": "Start before it is obvious. The advantage goes to whoever builds first.",
```

- [ ] **Step 7: Typecheck and test**

Run: `npm run build`
Expected: no output, exit 0.

Run: `npm test`
Expected: PASS, 11 tests.

- [ ] **Step 8: Commit**

```bash
git add src/types/video.ts src/services/script-schema.ts src/Root.tsx src/pipeline/test-render.ts scripts/example-payload.json
git commit -m "Add a narration field to the scene schema and prompt"
```

---

### Task 4: Groq speech synthesis

**Files:**
- Create: `src/services/tts.ts`
- Test: `src/services/tts.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type TtsResult = { audio: Buffer; voice: string; model: string }`
  - `synthesizeSpeech(text: string): Promise<TtsResult>`
  - `resolveTtsConfig(): { apiKey: string; voice: string; model: string }`
  - `describeTtsError(status: number, body: string): Error`
  - `groqVoices: readonly string[]`, `defaultTtsModel: string`, `defaultTtsVoice: string`

- [ ] **Step 1: Write the failing test**

Create `src/services/tts.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTtsError, groqVoices, resolveTtsConfig } from "./tts";

test("explains how to accept model terms", () => {
  const error = describeTtsError(
    400,
    JSON.stringify({ error: { code: "model_terms_required", message: "requires terms acceptance" } }),
  );
  assert.match(error.message, /console\.groq\.com/);
});

test("lists the valid voices when the voice is rejected", () => {
  const error = describeTtsError(400, JSON.stringify({ error: { message: "voice must be one of the following voices" } }));
  assert.match(error.message, /daniel/);
});

test("points at the key when authentication fails", () => {
  const error = describeTtsError(401, "unauthorized");
  assert.match(error.message, /LLM_API_KEY/);
});

test("keeps the raw body for unrecognised failures", () => {
  const error = describeTtsError(500, "upstream exploded");
  assert.match(error.message, /upstream exploded/);
});

test("every documented voice is present", () => {
  assert.deepEqual([...groqVoices], ["autumn", "diana", "hannah", "austin", "daniel", "troy"]);
});

test("rejects a voice outside the supported list", () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousVoice = process.env.TTS_VOICE;
  process.env.LLM_API_KEY = "test-key";
  process.env.TTS_VOICE = "gandalf";

  try {
    assert.throws(() => resolveTtsConfig(), /gandalf/);
  } finally {
    process.env.LLM_API_KEY = previousKey;
    process.env.TTS_VOICE = previousVoice;
  }
});
```

- [ ] **Step 2: Extend the test script**

In `package.json`, change the `test` script to:

```json
"test": "node --import tsx --test src/services/audio-duration.test.ts src/services/timing.test.ts src/services/tts.test.ts"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module './tts'`.

- [ ] **Step 4: Write the implementation**

Create `src/services/tts.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 17 tests.

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/services/tts.ts src/services/tts.test.ts package.json
git commit -m "Add Groq speech synthesis service"
```

---

### Task 5: The voiceover pipeline stage

**Files:**
- Create: `src/pipeline/voiceover.ts`
- Test: `src/pipeline/voiceover.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `getWavDurationSeconds` (Task 1), `computeSceneFrames` (Task 2), `narration`/`audioSrc` on `VideoScene` (Task 3), `resolveTtsConfig` and `synthesizeSpeech` (Task 4).
- Produces:
  - `narrationCacheKey(narration: string, voice: string, model: string): string`
  - `attachVoiceover(payload: VideoPayload): Promise<VideoPayload>`

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/voiceover.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { narrationCacheKey } from "./voiceover";

test("cache key is stable for identical input", () => {
  const first = narrationCacheKey("hello there", "daniel", "orpheus");
  const second = narrationCacheKey("hello there", "daniel", "orpheus");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
});

test("cache key changes with narration, voice or model", () => {
  const base = narrationCacheKey("hello there", "daniel", "orpheus");
  assert.notEqual(base, narrationCacheKey("hello world", "daniel", "orpheus"));
  assert.notEqual(base, narrationCacheKey("hello there", "troy", "orpheus"));
  assert.notEqual(base, narrationCacheKey("hello there", "daniel", "other"));
});
```

- [ ] **Step 2: Extend the test script**

In `package.json`, change the `test` script to:

```json
"test": "node --import tsx --test src/services/audio-duration.test.ts src/services/timing.test.ts src/services/tts.test.ts src/pipeline/voiceover.test.ts"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module './voiceover'`.

- [ ] **Step 4: Write the implementation**

Create `src/pipeline/voiceover.ts`:

```ts
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWavDurationSeconds } from "../services/audio-duration";
import { computeSceneFrames } from "../services/timing";
import { resolveTtsConfig, synthesizeSpeech } from "../services/tts";
import type { VideoPayload } from "../types/video";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const audioDir = path.join(rootDir, "public", "audio");

/** Identifies a clip by its content, so unchanged narration is never re-synthesized. */
export function narrationCacheKey(narration: string, voice: string, model: string): string {
  return crypto.createHash("sha256").update(`${narration} ${voice} ${model}`).digest("hex").slice(0, 16);
}

async function readCached(file: string) {
  try {
    return await fs.readFile(file);
  } catch {
    return undefined;
  }
}

/**
 * Synthesizes narration for every scene, then retimes each scene to its clip.
 * Returns a new payload; the input is not mutated.
 */
export async function attachVoiceover(payload: VideoPayload): Promise<VideoPayload> {
  const { voice, model } = resolveTtsConfig();
  await fs.mkdir(audioDir, { recursive: true });

  const scenes = [];

  for (const scene of payload.scenes) {
    const narration = scene.narration.trim();

    if (!narration) {
      console.log(`[voiceover] ${scene.id}: no narration, leaving silent`);
      scenes.push(scene);
      continue;
    }

    const key = narrationCacheKey(narration, voice, model);
    const file = path.join(audioDir, `${key}.wav`);

    let audio = await readCached(file);

    if (audio) {
      console.log(`[voiceover] ${scene.id}: cached`);
    } else {
      console.log(`[voiceover] ${scene.id}: synthesizing`);
      audio = (await synthesizeSpeech(narration)).audio;
      await fs.writeFile(file, audio);
    }

    const seconds = getWavDurationSeconds(audio);
    const durationInFrames = computeSceneFrames(seconds, payload.fps);

    console.log(`[voiceover] ${scene.id}: ${seconds.toFixed(2)}s -> ${durationInFrames} frames`);

    scenes.push({
      ...scene,
      durationInFrames,
      // staticFile() resolves against public/, so that prefix is dropped here.
      audioSrc: `audio/${key}.wav`,
    });
  }

  return { ...payload, scenes };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 19 tests.

- [ ] **Step 6: Ignore generated audio**

Append to `.gitignore`:

```
public/audio/
```

- [ ] **Step 7: Typecheck**

Run: `npm run build`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/voiceover.ts src/pipeline/voiceover.test.ts package.json .gitignore
git commit -m "Add the voiceover pipeline stage"
```

---

### Task 6: Play the audio and wire the stage into rendering

**Files:**
- Modify: `src/components/Scene.tsx`
- Modify: `src/pipeline/render.ts`
- Modify: `src/pipeline/test-render.ts`

**Interfaces:**
- Consumes: `attachVoiceover` (Task 5), `LEAD_IN_SECONDS` (Task 2), `scene.audioSrc` (Task 3).
- Produces: `renderVideo(topic: string, payloadOverride?: VideoPayload, options?: { audio?: boolean })`. Audio runs unless `options.audio === false`.

- [ ] **Step 1: Play the clip inside the scene**

In `src/components/Scene.tsx`, replace the remotion import line with:

```tsx
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
```

Add this import beneath the existing `AnimatedText` import:

```tsx
import { LEAD_IN_SECONDS } from "../services/timing";
```

Note it imports from `../services/timing`, never from `../pipeline/voiceover`. The pipeline module pulls in `node:fs` and `node:crypto`, which would break the browser bundle Remotion builds from this file.

Inside the component, directly below the existing `bgGlow` line, add:

```tsx
  const { fps } = useVideoConfig();
  const leadInFrames = Math.round(LEAD_IN_SECONDS * fps);
```

Then add this as the first child inside the outer `<AbsoluteFill>`, above the existing glow `<div>`:

```tsx
      {scene.audioSrc ? (
        <Sequence from={leadInFrames}>
          <Audio src={staticFile(scene.audioSrc)} />
        </Sequence>
      ) : null}
```

The `<Sequence from>` wrapper is what delays speech by the lead-in that `computeSceneFrames` already budgeted for.

- [ ] **Step 2: Add the stage and the flag to the renderer**

In `src/pipeline/render.ts`, add to the imports:

```ts
import { attachVoiceover } from "./voiceover";
```

Replace the `renderVideo` signature and its first line with:

```ts
export async function renderVideo(
  topic: string,
  payloadOverride?: VideoPayload,
  options: { audio?: boolean } = {},
) {
  const script = payloadOverride ?? (await generateScript(topic));
  const payload = options.audio === false ? script : await attachVoiceover(script);
```

In `parseArgs`, add `"--no-audio"` to the `consumed` set so it is never mistaken for a positional topic:

```ts
  const consumed = new Set([topicFlag, payloadFile, "--topic", "--payload", "--no-audio", "--"]);
```

and replace the `return` block with:

```ts
  return {
    payloadFile,
    topic: topicFlag ?? positional,
    audio: !argv.includes("--no-audio"),
  };
```

In the `isDirectRun` block, destructure the new field and forward it in both branches:

```ts
    const { topic, payloadFile, audio } = parseArgs(process.argv.slice(2));

    if (payloadFile) {
      const payload = await loadPayloadFile(payloadFile);
      const name = topic || payload.title;
      console.log(`Rendering payload from ${payloadFile}`);
      const result = await renderVideo(name, payload, { audio });
      console.log(`Render complete: ${result.outputLocation}`);
      return;
    }
```

```ts
    const result = await renderVideo(topic, undefined, { audio });
```

- [ ] **Step 3: Keep the smoke test offline**

`mockPayload` now carries narration, so the smoke test would start calling Groq. In `src/pipeline/test-render.ts`, replace the `renderVideo` call with:

```ts
  const result = await renderVideo("Smoke test", mockPayload, { audio: false });
```

- [ ] **Step 4: Verify the smoke test still runs with no network**

Run: `npm run test:render`
Expected: no `[voiceover]` lines at all, progress output, and `Smoke test complete:`.

- [ ] **Step 5: Verify the flag on the payload path**

Run: `npm run start -- --payload scripts/example-payload.json --no-audio --topic silent-check`
Expected: no `[voiceover]` lines, and `out/silent-check.mp4` written.

- [ ] **Step 6: Typecheck and test**

Run: `npm run build`
Expected: no output, exit 0.

Run: `npm test`
Expected: PASS, 19 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/Scene.tsx src/pipeline/render.ts src/pipeline/test-render.ts
git commit -m "Play scene narration and wire voiceover into rendering"
```

---

### Task 7: Live end-to-end verification

Everything before this is offline. This task proves the whole chain against the real service.

**Files:**
- Modify: `.env.example`
- Modify: `roadmap.md`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: nothing new.

- [ ] **Step 1: Document the new environment variables**

Append to `.env.example`:

```
# Voiceover. Reuses LLM_API_KEY; only groq is supported today.
# Voices: autumn, diana, hannah, austin, daniel, troy
TTS_PROVIDER=groq
TTS_VOICE=daniel
TTS_MODEL=
```

- [ ] **Step 2: Render from the example payload with audio**

Run: `npm run start -- --payload scripts/example-payload.json --topic voiceover-check`

Expected: three `[voiceover] scene-N: synthesizing` lines, each followed by a measured duration and a frame count well above the old fixed 100, then `Render complete:`.

- [ ] **Step 3: Confirm the cache works**

Run the exact same command again.

Expected: three `[voiceover] scene-N: cached` lines and no synthesis delay.

- [ ] **Step 4: Confirm the output actually carries audio**

Run: `npx remotion ffprobe out/voiceover-check.mp4`

Expected: an `Audio: aac` stream, and a `Duration:` noticeably longer than the 10 seconds the fixed 100-frame scenes used to produce.

- [ ] **Step 5: Run the full topic-to-video flow**

Run: `npm run start -- --topic "The Future of AI"`

Expected: a Groq script containing narration, three synthesized clips, and a finished `out/the-future-of-ai.mp4`.

- [ ] **Step 6: Confirm no audio was staged for commit**

Run: `git status --short`
Expected: no `public/audio/` entries.

- [ ] **Step 7: Update the roadmap**

Append to `roadmap.md`:

```markdown

---

### Phase 8: Voiceover Audio
- [x] Add `narration` to the scene schema and the generation prompt.
- [x] Synthesize per-scene speech through Groq, reusing `LLM_API_KEY`.
- [x] Measure each clip from its WAV header with no added dependency.
- [x] Rewrite `durationInFrames` from measured speech length.
- [x] Cache clips by content hash so unchanged narration is never re-synthesized.
- [x] Support `--no-audio` for offline, network-free renders.
```

- [ ] **Step 8: Commit and push**

```bash
git add .env.example roadmap.md
git commit -m "Document voiceover configuration and record the phase"
git push
```

---

## Verification Checklist

- [ ] `npm test` passes, 19 tests.
- [ ] `npm run build` is clean.
- [ ] `npm run test:render` renders with no network access and no `[voiceover]` output.
- [ ] `--no-audio` produces no `[voiceover]` output on the payload path too.
- [ ] A second identical run reports `cached` for every scene.
- [ ] The rendered MP4 carries an audio stream and its scene lengths track the narration.
- [ ] `git status` shows no `public/audio/` files staged.
