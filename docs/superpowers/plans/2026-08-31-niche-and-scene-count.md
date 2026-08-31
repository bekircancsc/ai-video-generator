# Niche Briefs and Variable Scene Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a run be briefed by a niche instead of only a topic, and let the model write between three and eight scenes instead of exactly three.

**Architecture:** A `ScriptBrief` object (`topic?`, `niche?`, `sceneCount?`) replaces the bare `topic: string` across the script-generation seam. The JSON schema handed to the model becomes a builder that pins an exact scene count or spans 3-8, and a second check after Zod validation catches endpoints that ignore the schema — feeding the existing repair retry. `parseArgs` moves out of `render.ts` into its own service so argument parsing can be tested without importing a bundler.

**Tech Stack:** Node 22+, TypeScript (ESM, run via `tsx`), Zod 4, Remotion 4, `node:test` runner.

## Global Constraints

- Scene count range for generated scripts: **minimum 3, maximum 8**. Exported as `MIN_SCENES` / `MAX_SCENES` from `src/services/script-schema.ts`; never re-typed as bare literals elsewhere.
- Hand-written payload files (`--payload`) are exempt from the range. `loadPayloadFile` must keep using a parse path that applies no count check.
- The Zod schema in `src/types/video.ts` keeps `scenes` at `.min(1)` and gains no maximum. Do not edit that file.
- Nothing under `src/components/` may be touched; no module reachable from `src/Root.tsx` may import `node:fs`, `node:crypto` or `dotenv`.
- English only. Do not change the TTS voice, the Whisper model, or the language of the prompt.
- Tests use the built-in `node:test` runner with `node:assert/strict`, matching every existing `*.test.ts` in this repo. Every new test file must be added to the `test` script in `package.json`.
- Commit after each task. Work on the current branch (`feature/niche-and-scene-count`).

---

### Task 1: Move `parseArgs` into its own service

`parseArgs` currently lives in `src/pipeline/render.ts`, which imports `@remotion/bundler` and `@remotion/renderer` at module scope — so a unit test of argument parsing would pull an entire bundler into the test process. Move it first, with no behaviour change, so the next task can test the new flags cheaply.

**Files:**
- Create: `src/services/cli-args.ts`
- Create: `src/services/cli-args.test.ts`
- Modify: `src/pipeline/render.ts` (delete `parseArgs`, import it instead)
- Modify: `package.json` (add the new test file to the `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `parseArgs(argv: string[]): { payloadFile?: string; topic: string; audio: boolean }` from `src/services/cli-args.ts`. Task 2 extends this return type.

- [ ] **Step 1: Write the failing test**

Create `src/services/cli-args.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./cli-args";

test("reads --topic", () => {
  assert.equal(parseArgs(["--topic", "The Future of AI"]).topic, "The Future of AI");
});

test("treats a bare positional argument as the topic", () => {
  assert.equal(parseArgs(["The", "Future", "of", "AI"]).topic, "The Future of AI");
});

test("reads --payload", () => {
  assert.equal(parseArgs(["--payload", "scripts/example-payload.json"]).payloadFile, "scripts/example-payload.json");
});

test("audio is on by default and off with --no-audio", () => {
  assert.equal(parseArgs(["--topic", "x"]).audio, true);
  assert.equal(parseArgs(["--topic", "x", "--no-audio"]).audio, false);
});

test("a flag with no value is an error", () => {
  assert.throws(() => parseArgs(["--topic"]), /--topic requires a value/);
  assert.throws(() => parseArgs(["--topic", "--no-audio"]), /--topic requires a value/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/services/cli-args.test.ts` — or directly:
`node --import tsx --test src/services/cli-args.test.ts`
Expected: FAIL, cannot find module `./cli-args`.

- [ ] **Step 3: Create `src/services/cli-args.ts`**

Move the function across verbatim from `src/pipeline/render.ts`, keeping its doc comment:

```ts
/** Reads `--topic <value>` and `--payload <file>`, tolerating bare positional topics. */
export function parseArgs(argv: string[]) {
  const flagValue = (flag: string) => {
    const index = argv.indexOf(flag);

    if (index === -1) {
      return undefined;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }

    return value;
  };

  const payloadFile = flagValue("--payload");
  const topicFlag = flagValue("--topic");
  const consumed = new Set([topicFlag, payloadFile, "--topic", "--payload", "--no-audio", "--"]);
  const positional = argv.filter((arg) => !consumed.has(arg)).join(" ").trim();

  return {
    payloadFile,
    topic: topicFlag ?? positional,
    audio: !argv.includes("--no-audio"),
  };
}
```

- [ ] **Step 4: Delete `parseArgs` from `src/pipeline/render.ts` and import it**

Remove the entire `export function parseArgs(...)` block from `src/pipeline/render.ts` and add to its imports:

```ts
import { parseArgs } from "../services/cli-args";
```

`render.ts` calls `parseArgs(process.argv.slice(2))` in its `isDirectRun` block; that call site is unchanged.

- [ ] **Step 5: Register the test file**

In `package.json`, append ` src/services/cli-args.test.ts` to the end of the `test` script's file list.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npm test`
Expected: PASS, including the five new `cli-args` tests.

Run: `npm run build`
Expected: no output (typecheck clean).

- [ ] **Step 7: Commit**

```bash
git add src/services/cli-args.ts src/services/cli-args.test.ts src/pipeline/render.ts package.json
git commit -m "Move argument parsing out of the render pipeline"
```

---

### Task 2: Add `--niche` and `--scenes` to the parser

**Files:**
- Modify: `src/services/cli-args.ts`
- Modify: `src/services/cli-args.test.ts`

**Interfaces:**
- Consumes: `parseArgs` from Task 1.
- Produces: `parseArgs(argv: string[]): { payloadFile?: string; topic: string; niche?: string; sceneCount?: number; audio: boolean }`. Task 5 reads `niche` and `sceneCount` from this.

**Prerequisite: Task 3 must be done first.** It defines `MIN_SCENES` and `MAX_SCENES` in `src/services/script-schema.ts`, which this task imports. The execution order for the whole plan is 1, 3, 2, 4, 5, 6.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/cli-args.test.ts`:

```ts
test("reads --niche", () => {
  assert.equal(parseArgs(["--niche", "stoic philosophy"]).niche, "stoic philosophy");
});

test("niche and topic combine", () => {
  const args = parseArgs(["--niche", "stoic philosophy", "--topic", "Amor fati"]);
  assert.equal(args.niche, "stoic philosophy");
  assert.equal(args.topic, "Amor fati");
});

test("a niche does not leak into the positional topic", () => {
  assert.equal(parseArgs(["--niche", "stoic philosophy"]).topic, "");
});

test("reads --scenes as a number", () => {
  assert.equal(parseArgs(["--topic", "x", "--scenes", "6"]).sceneCount, 6);
});

test("scene count is undefined when the flag is absent", () => {
  assert.equal(parseArgs(["--topic", "x"]).sceneCount, undefined);
});

test("--scenes rejects anything outside 3 to 8", () => {
  assert.throws(() => parseArgs(["--topic", "x", "--scenes", "2"]), /between 3 and 8/);
  assert.throws(() => parseArgs(["--topic", "x", "--scenes", "9"]), /between 3 and 8/);
});

test("--scenes rejects a non-integer", () => {
  assert.throws(() => parseArgs(["--topic", "x", "--scenes", "abc"]), /between 3 and 8/);
  assert.throws(() => parseArgs(["--topic", "x", "--scenes", "4.5"]), /between 3 and 8/);
});

test("--scenes with no value is an error", () => {
  assert.throws(() => parseArgs(["--topic", "x", "--scenes"]), /--scenes requires a value/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/services/cli-args.test.ts`
Expected: FAIL — `niche` and `sceneCount` are `undefined`, and the `--scenes` validation throws never happen.

- [ ] **Step 3: Implement the two flags**

Replace the body of `parseArgs` in `src/services/cli-args.ts` with:

```ts
import { MAX_SCENES, MIN_SCENES } from "./script-schema";

/**
 * Reads the generation flags, tolerating a bare positional topic.
 * `--scenes` is validated here so a bad value fails before any model call.
 */
export function parseArgs(argv: string[]) {
  const flagValue = (flag: string) => {
    const index = argv.indexOf(flag);

    if (index === -1) {
      return undefined;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }

    return value;
  };

  const payloadFile = flagValue("--payload");
  const topicFlag = flagValue("--topic");
  const niche = flagValue("--niche");
  const scenesFlag = flagValue("--scenes");

  let sceneCount: number | undefined;

  if (scenesFlag !== undefined) {
    sceneCount = Number(scenesFlag);

    if (!Number.isInteger(sceneCount) || sceneCount < MIN_SCENES || sceneCount > MAX_SCENES) {
      throw new Error(`--scenes must be a whole number between ${MIN_SCENES} and ${MAX_SCENES}, got "${scenesFlag}"`);
    }
  }

  const consumed = new Set([
    topicFlag,
    payloadFile,
    niche,
    scenesFlag,
    "--topic",
    "--payload",
    "--niche",
    "--scenes",
    "--no-audio",
    "--",
  ]);
  const positional = argv.filter((arg) => !consumed.has(arg)).join(" ").trim();

  return {
    payloadFile,
    topic: topicFlag ?? positional,
    niche,
    sceneCount,
    audio: !argv.includes("--no-audio"),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test src/services/cli-args.test.ts`
Expected: PASS, all thirteen tests.

Run: `npm run build`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/services/cli-args.ts src/services/cli-args.test.ts
git commit -m "Accept a niche and an explicit scene count on the CLI"
```

---

### Task 3: The brief, the prompt and the scene-count schema

The heart of the change. `buildScriptPrompt` stops taking a string, the JSON schema becomes a builder, and a second parse entry point enforces the count on endpoints that ignore the schema.

**Files:**
- Modify: `src/services/script-schema.ts`
- Create: `src/services/script-schema.test.ts`
- Modify: `package.json` (add the new test file to the `test` script)

**Interfaces:**
- Consumes: `parseScriptJson`, `videoPayloadSchema` (unchanged, from `src/types/video.ts`).
- Produces, all from `src/services/script-schema.ts`:
  - `MIN_SCENES = 3`, `MAX_SCENES = 8`
  - `type ScriptBrief = { topic?: string; niche?: string; sceneCount?: number }`
  - `buildScriptPrompt(brief: ScriptBrief): string`
  - `buildVideoPayloadJsonSchema(sceneCount?: number): object`
  - `parseScriptJson(raw: string): VideoPayload` — unchanged signature, no count check
  - `parseGeneratedScript(raw: string, sceneCount?: number): VideoPayload` — parses, then enforces the count
  - `scriptSystemPrompt` — unchanged

The split between `parseScriptJson` and `parseGeneratedScript` is deliberate: the spec requires that `loadPayloadFile` apply no count check at all, and an explicit second function makes that boundary visible rather than hiding it behind an optional argument that must be omitted just so.

- [ ] **Step 1: Write the failing tests**

Create `src/services/script-schema.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCENES,
  MIN_SCENES,
  buildScriptPrompt,
  buildVideoPayloadJsonSchema,
  parseGeneratedScript,
  parseScriptJson,
} from "./script-schema";

/** A valid payload with `count` scenes, as JSON, for the parse tests. */
function payloadJson(count: number) {
  const scenes = Array.from({ length: count }, (_, index) => ({
    id: `scene-${index + 1}`,
    text: "Punchy line",
    subtext: "A shorter supporting line",
    narration: "This is what the voiceover says for this scene.",
    durationInFrames: 100,
    themeColor: "#7c3aed",
    keywords: ["one", "two"],
  }));

  return JSON.stringify({ title: "A Title", fps: 30, aspectRatio: "9:16", scenes });
}

test("a topic-only brief names the topic", () => {
  const prompt = buildScriptPrompt({ topic: "Amor fati" });
  assert.match(prompt, /Amor fati/);
  assert.doesNotMatch(prompt, /niche/i);
});

test("a niche-only brief asks the model to pick the topic", () => {
  const prompt = buildScriptPrompt({ niche: "stoic philosophy" });
  assert.match(prompt, /stoic philosophy/);
  assert.match(prompt, /[Pp]ick one specific/);
});

test("a brief with both keeps the topic and adds the niche as context", () => {
  const prompt = buildScriptPrompt({ topic: "Amor fati", niche: "stoic philosophy" });
  assert.match(prompt, /Amor fati/);
  assert.match(prompt, /stoic philosophy/);
  assert.match(prompt, /tone/i);
});

test("an exact scene count is stated in the prompt", () => {
  assert.match(buildScriptPrompt({ topic: "x", sceneCount: 6 }), /exactly 6 scenes/);
});

test("without a count the prompt offers the range", () => {
  const prompt = buildScriptPrompt({ topic: "x" });
  assert.match(prompt, new RegExp(`between ${MIN_SCENES} and ${MAX_SCENES} scenes`));
});

test("the JSON schema pins an exact count when given one", () => {
  const schema = buildVideoPayloadJsonSchema(6) as any;
  assert.equal(schema.properties.scenes.minItems, 6);
  assert.equal(schema.properties.scenes.maxItems, 6);
});

test("the JSON schema spans the range when given no count", () => {
  const schema = buildVideoPayloadJsonSchema() as any;
  assert.equal(schema.properties.scenes.minItems, MIN_SCENES);
  assert.equal(schema.properties.scenes.maxItems, MAX_SCENES);
});

test("the JSON schema still requires narration on every scene", () => {
  const schema = buildVideoPayloadJsonSchema() as any;
  assert.ok(schema.properties.scenes.items.required.includes("narration"));
});

test("parseGeneratedScript accepts a matching exact count", () => {
  assert.equal(parseGeneratedScript(payloadJson(6), 6).scenes.length, 6);
});

test("parseGeneratedScript rejects a count that contradicts the brief", () => {
  assert.throws(() => parseGeneratedScript(payloadJson(5), 6), /6 scenes.*got 5/);
});

test("parseGeneratedScript accepts anything inside the range with no exact count", () => {
  assert.equal(parseGeneratedScript(payloadJson(8)).scenes.length, 8);
  assert.equal(parseGeneratedScript(payloadJson(3)).scenes.length, 3);
});

test("parseGeneratedScript rejects a count outside the range", () => {
  assert.throws(() => parseGeneratedScript(payloadJson(2)), /between 3 and 8/);
  assert.throws(() => parseGeneratedScript(payloadJson(9)), /between 3 and 8/);
});

test("parseScriptJson applies no count check at all", () => {
  assert.equal(parseScriptJson(payloadJson(12)).scenes.length, 12);
  assert.equal(parseScriptJson(payloadJson(1)).scenes.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/services/script-schema.test.ts`
Expected: FAIL — `MIN_SCENES`, `buildVideoPayloadJsonSchema` and `parseGeneratedScript` are not exported, and `buildScriptPrompt` takes a string.

- [ ] **Step 3: Rewrite the top of `src/services/script-schema.ts`**

Replace the `videoPayloadJsonSchema` constant and `buildScriptPrompt` with the following. Keep `stripFences` and `parseScriptJson` exactly as they are.

```ts
import { videoPayloadSchema, type VideoPayload } from "../types/video";

/** The scene count a generated script may use. Hand-written payload files are exempt. */
export const MIN_SCENES = 3;
export const MAX_SCENES = 8;

/** What a run is asking for. At least one of `topic` or `niche` is set by the CLI. */
export type ScriptBrief = {
  topic?: string;
  niche?: string;
  sceneCount?: number;
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
          },
          required: ["id", "text", "subtext", "narration", "durationInFrames", "themeColor", "keywords"],
        },
      },
    },
    required: ["title", "fps", "aspectRatio", "scenes"],
  };
}

export const scriptSystemPrompt =
  "You are a short-form video scriptwriter. You reply with valid JSON only, no prose and no markdown fences.";

/** The opening sentences, which differ by what the brief actually names. */
function briefLines({ topic, niche }: ScriptBrief) {
  if (topic && niche) {
    return [
      `Generate a high-engagement social media video script for the topic: "${topic}".`,
      `The video is for a channel in this niche: "${niche}".`,
      "Match that niche's audience, tone and vocabulary.",
    ];
  }

  if (niche) {
    return [
      `Generate a high-engagement social media video script for a channel in this niche: "${niche}".`,
      "Pick one specific, high-engagement topic within that niche and write the script for it.",
      "Match that niche's audience, tone and vocabulary.",
    ];
  }

  return [`Generate a high-engagement social media video script for the topic: "${topic}".`];
}

function sceneCountLine(sceneCount?: number) {
  if (sceneCount) {
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
    sceneCountLine(brief.sceneCount),
    "short subtitles, vibrant six-digit hex theme colors, and a 9:16 aspect ratio.",
    "Keep `text` under 40 characters and `subtext` under 90 characters so it fits a vertical frame.",
    "Write `text` and `subtext` for the eye: short, punchy, readable at a glance.",
    "Write `narration` for the ear: one or two spoken sentences per scene, conversational,",
    "no abbreviations and no symbols, roughly 12 to 25 words, reading on naturally from the",
    "previous scene so the scene narrations form one continuous voiceover.",
    "Respond with JSON matching this schema:",
    JSON.stringify(buildVideoPayloadJsonSchema(brief.sceneCount)),
  ].join("\n");
}
```

- [ ] **Step 4: Add `parseGeneratedScript` below `parseScriptJson`**

Append to `src/services/script-schema.ts`:

```ts
/**
 * Parses model output and enforces the scene count the brief asked for.
 * The thrown message is fed back to the model by the repair retry, so it names
 * both the expectation and what arrived.
 */
export function parseGeneratedScript(raw: string, sceneCount?: number): VideoPayload {
  const payload = parseScriptJson(raw);
  const actual = payload.scenes.length;

  if (sceneCount && actual !== sceneCount) {
    throw new Error(`The script must have exactly ${sceneCount} scenes, got ${actual}`);
  }

  if (!sceneCount && (actual < MIN_SCENES || actual > MAX_SCENES)) {
    throw new Error(`The script must have between ${MIN_SCENES} and ${MAX_SCENES} scenes, got ${actual}`);
  }

  return payload;
}
```

- [ ] **Step 5: Register the test file**

In `package.json`, append ` src/services/script-schema.test.ts` to the end of the `test` script's file list.

- [ ] **Step 6: Run the tests**

Run: `node --import tsx --test src/services/script-schema.test.ts`
Expected: PASS, all thirteen tests.

Run: `npm run build`
Expected: FAIL — `openai-compatible.ts` and `gemini.ts` still import the removed `videoPayloadJsonSchema` constant and call `buildScriptPrompt` with a string. Task 4 fixes both. Do not "fix" them by re-adding the constant.

- [ ] **Step 7: Commit**

```bash
git add src/services/script-schema.ts src/services/script-schema.test.ts package.json
git commit -m "Brief the scriptwriter with a niche and a scene count"
```

---

### Task 4: Thread the brief through both providers

**Files:**
- Modify: `src/services/openai-compatible.ts`
- Modify: `src/services/gemini.ts`
- Modify: `src/services/script-provider.ts`

**Interfaces:**
- Consumes: `ScriptBrief`, `buildScriptPrompt`, `buildVideoPayloadJsonSchema`, `parseGeneratedScript` from Task 3.
- Produces:
  - `generateWithOpenAICompatible(brief: ScriptBrief, provider: string): Promise<VideoPayload>`
  - `generateVideoPayload(brief: ScriptBrief): Promise<VideoPayload>` (gemini)
  - `generateScript(brief: ScriptBrief): Promise<VideoPayload>` — Task 5 calls this.

There is no new test file here: these three modules are network adapters with no pure logic of their own, and the repo has no HTTP fixtures. `npm run build` is the gate.

- [ ] **Step 1: Update `src/services/openai-compatible.ts`**

Change the import line from:

```ts
import { buildScriptPrompt, parseScriptJson, scriptSystemPrompt, videoPayloadJsonSchema } from "./script-schema";
```

to:

```ts
import {
  buildScriptPrompt,
  buildVideoPayloadJsonSchema,
  parseGeneratedScript,
  scriptSystemPrompt,
  type ScriptBrief,
} from "./script-schema";
```

`callChatCompletions` builds the `json_schema` body from the constant. Give it the schema instead of letting it reach for a global — add a parameter:

```ts
async function callChatCompletions(
  config: { baseUrl: string; model: string; apiKey: string },
  messages: Message[],
  useJsonSchema: boolean,
  jsonSchema: object,
) {
```

and inside its `body`, replace `schema: videoPayloadJsonSchema` with `schema: jsonSchema`.

- [ ] **Step 2: Update `generateWithOpenAICompatible`**

Change its signature and its two body references:

```ts
export async function generateWithOpenAICompatible(brief: ScriptBrief, provider: string): Promise<VideoPayload> {
  const config = resolveConfig(provider);
  const jsonSchema = buildVideoPayloadJsonSchema(brief.sceneCount);

  const messages: Message[] = [
    { role: "system", content: scriptSystemPrompt },
    { role: "user", content: buildScriptPrompt(brief) },
  ];
```

Inside the retry loop, the call becomes:

```ts
      raw = await callChatCompletions(config, messages, useJsonSchema, jsonSchema);
```

and the parse becomes:

```ts
      return parseGeneratedScript(raw, brief.sceneCount);
```

Everything else in the loop — the 400 fallback to `json_object`, the repair message pushed onto `messages`, the final throw — stays exactly as it is. The scene-count error now flows into the same repair retry as any other validation error.

- [ ] **Step 2b: Verify the repair retry still gets two attempts**

Read the loop once after editing. `attempt -= 1` on the `json_schema` fallback and `for (let attempt = 0; attempt < 2; attempt += 1)` must both be untouched.

- [ ] **Step 3: Update `src/services/gemini.ts`**

Change its import to:

```ts
import { buildScriptPrompt, parseGeneratedScript, type ScriptBrief } from "./script-schema";
```

Change the function to take a brief:

```ts
export async function generateVideoPayload(brief: ScriptBrief): Promise<VideoPayload> {
  const client = createGeminiClient();

  const response = await client.models
    .generateContent({
      model: process.env.LLM_MODEL || "gemini-2.5-flash",
      contents: buildScriptPrompt(brief),
```

and its return:

```ts
  return parseGeneratedScript(response.text ?? "", brief.sceneCount);
}
```

Leave the local `responseSchema` constant alone. Its `scenes` array has no `minItems`/`maxItems` today, so it already permits any count; the count is carried by the prompt and enforced by `parseGeneratedScript`. Gemini has no repair retry, so a miscount fails the run with a clear message — acceptable, and unchanged from how every other validation failure behaves on that path.

- [ ] **Step 4: Update `src/services/script-provider.ts`**

Change its import to add the brief type:

```ts
import { parseScriptJson, type ScriptBrief } from "./script-schema";
```

and change `generateScript`:

```ts
/** Generates a payload using whichever provider SCRIPT_PROVIDER selects. */
export async function generateScript(brief: ScriptBrief): Promise<VideoPayload> {
  const provider = (process.env.SCRIPT_PROVIDER || defaultProvider).toLowerCase();

  if (provider === "manual") {
    throw new Error(
      "SCRIPT_PROVIDER=manual expects a payload file. Run with --payload <file.json>, or set SCRIPT_PROVIDER to a live provider.",
    );
  }

  if (provider === "gemini") {
    const { generateVideoPayload } = await import("./gemini");
    return generateVideoPayload(brief);
  }

  if (provider in presets) {
    return generateWithOpenAICompatible(brief, provider);
  }

  throw new Error(
    `Unknown SCRIPT_PROVIDER "${provider}". Supported: ${Object.keys(presets).join(", ")}, gemini, manual.`,
  );
}
```

`loadPayloadFile` in the same file keeps calling `parseScriptJson(raw)` — no count check on hand-written files. Do not change it.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: FAIL, but now only in `src/pipeline/render.ts`, which still calls `generateScript(topic)` with a string. Task 5 fixes it.

- [ ] **Step 6: Commit**

```bash
git add src/services/openai-compatible.ts src/services/gemini.ts src/services/script-provider.ts
git commit -m "Pass the brief through both script providers"
```

---

### Task 5: Wire the CLI to the brief

**Files:**
- Modify: `src/pipeline/render.ts`

**Interfaces:**
- Consumes: `parseArgs` (Task 2), `generateScript`, `ScriptBrief` (Tasks 3-4).
- Produces: `renderVideo(brief: ScriptBrief, payloadOverride?: VideoPayload, options?: { audio?: boolean })`.

- [ ] **Step 1: Change `renderVideo` to take a brief**

In `src/pipeline/render.ts`, add `ScriptBrief` to the script-provider import area:

```ts
import type { ScriptBrief } from "../services/script-schema";
```

Change the signature and the two places the topic was used:

```ts
export async function renderVideo(
  brief: ScriptBrief,
  payloadOverride?: VideoPayload,
  options: { audio?: boolean } = {},
) {
  const script = payloadOverride ?? (await generateScript(brief));
```

and, further down, the output name — a niche-only run has no topic, so the model's own title names the file:

```ts
  const outputLocation = path.join(outDir, `${slugify(brief.topic || payload.title)}.mp4`);
```

Everything between — the bundle, `selectComposition`, `renderMedia`, the progress log — is unchanged.

- [ ] **Step 2: Rewrite the `isDirectRun` block**

Replace the whole `const run = async () => { ... }` body with:

```ts
  const run = async () => {
    const { topic, niche, sceneCount, payloadFile, audio } = parseArgs(process.argv.slice(2));
    const brief: ScriptBrief = { topic, niche, sceneCount };

    if (payloadFile) {
      const payload = await loadPayloadFile(payloadFile);
      console.log(`Rendering payload from ${payloadFile}`);
      const result = await renderVideo({ ...brief, topic: topic || payload.title }, payload, { audio });
      console.log(`Render complete: ${result.outputLocation}`);
      return;
    }

    if (!topic && !niche) {
      throw new Error(
        "A topic or a niche must be provided via --topic or --niche, or a script via --payload <file.json>",
      );
    }

    const provider = process.env.SCRIPT_PROVIDER || defaultProvider;
    const subject = topic ? `topic: ${topic}` : `niche: ${niche}`;
    const scenes = sceneCount ? `, ${sceneCount} scenes` : "";
    console.log(`Generating video for ${subject} (provider: ${provider}${scenes})`);

    const result = await renderVideo(brief, undefined, { audio });
    console.log(`Render complete: ${result.outputLocation}`);
  };
```

- [ ] **Step 3: Check the other caller**

Run: `grep -rn "renderVideo" src/`
`src/pipeline/test-render.ts` is the only other caller. If it passes a string as the first argument, change that argument to `{ topic: "<the same string>" }`. Make no other change to that file.

- [ ] **Step 4: Typecheck and run every test**

Run: `npm run build`
Expected: no output — the whole tree typechecks for the first time since Task 3.

Run: `npm test`
Expected: PASS, every file.

- [ ] **Step 5: Prove the render path offline**

Run: `npm run test:render`
Expected: an MP4 written under `out/`, no network call.

Run: `node run.mjs --payload scripts/example-payload.json --no-audio`
Expected: a render completing with a path printed. This exercises the payload branch of the block rewritten in Step 2.

- [ ] **Step 6: Verify the argument errors by hand**

Run: `node run.mjs --scenes 9 --topic x`
Expected: `Render failed: --scenes must be a whole number between 3 and 8, got "9"` — and no model call.

Run: `node run.mjs`
Expected: `Render failed: A topic or a niche must be provided via --topic or --niche, or a script via --payload <file.json>`

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/render.ts src/pipeline/test-render.ts
git commit -m "Render from a brief rather than a bare topic"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Update the CLI section of `README.md`**

Change the usage line to:

```bash
npm run start -- [--topic <topic>] [--niche <niche>] [--scenes <n>] [--payload <file.json>] [--no-audio]
```

and add two rows to the flag table, keeping its existing style:

```markdown
| `--niche <niche>` | Who the video is for. On its own, the model also picks the topic. With `--topic`, it sets the audience and tone. |
| `--scenes <n>` | Exact number of scenes, 3 to 8. Left off, the model picks a number to suit the topic. |
```

- [ ] **Step 2: Add an example beside the opening one**

Under the existing quick-start example in `README.md`, add:

```bash
npm run start -- --niche "stoic philosophy for busy men" --scenes 6
```

- [ ] **Step 3: Correct the fixed-three-scenes claim**

`README.md` describes the Script stage as producing "A validated `VideoPayload`: three scenes, each with on-screen text and a `narration` line written for the ear." Replace "three scenes" with "three to eight scenes". Check the rest of the file for any other claim that the count is three and fix it the same way.

- [ ] **Step 4: Add Phase 11 to `roadmap.md`**

Append, matching the file's existing heading and checkbox style:

```markdown
---

### Phase 11: Niche Briefs and Variable Scene Count
- [x] Replace the bare topic string with a `ScriptBrief` across the generation seam.
- [x] Add `--niche`, alone (the model picks the topic) or alongside `--topic` (audience and tone).
- [x] Add `--scenes <n>`, validated to 3-8 before any model call.
- [x] Turn the fixed three-scene JSON schema into a builder that pins an exact count or spans 3-8.
- [x] Enforce the count again after validation so the repair retry can correct a miscount.
- [x] Keep hand-written `--payload` files exempt from the range.
- [x] Extract `parseArgs` into `src/services/cli-args.ts` and cover it with tests.
```

- [ ] **Step 5: Commit**

```bash
git add README.md roadmap.md
git commit -m "Document the niche brief and the scene count flag"
```

---

## Execution order

Task 2 imports `MIN_SCENES` and `MAX_SCENES`, which Task 3 creates. **Run Task 1, then Task 3, then Task 2, then Tasks 4, 5, 6.** The tree does not typecheck between Task 3 and Task 5; that is expected and called out in each affected step.
