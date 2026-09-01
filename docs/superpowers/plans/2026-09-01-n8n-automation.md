# n8n Publishing Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a scheduled n8n workflow produce a video from a niche document and upload it to YouTube as a private draft, by giving the existing CLI a machine-readable contract.

**Architecture:** n8n calls `npm run start` once and reads one JSON object from stdout. Nothing about the generation pipeline moves into n8n. Four additions to the repo carry the contract: a `--niche-file` flag, a `youtube` block on the payload, a `--json` output mode that keeps stdout clean, and a `history.json` of published titles fed back into the prompt so a fixed niche does not produce the same video twice.

**Tech Stack:** Node 22, TypeScript, zod, `node:test` + `node:assert/strict`, Remotion 4, n8n (native Windows install).

**Spec:** `docs/superpowers/specs/2026-09-01-n8n-automation-design.md`

## Global Constraints

- Node 22 or newer. ESM only (`"type": "module"`); every relative import is extensionless TypeScript resolved by `tsx`.
- Tests use the built-in runner: `import test from "node:test"` and `import assert from "node:assert/strict"`. No test framework is installed and none may be added.
- Every new test file must be appended to the `test` script in `package.json`, or it will never run.
- Anything imported by `src/components/**` or `src/services/timing.ts` must not import `node:*` or `dotenv` — Remotion bundles those for the browser. `src/services/result.ts` and `src/services/history.ts` are Node-only and are never imported by a component.
- `src/services/cli-args.ts` stays pure: it parses argv and does no file I/O. Reading the niche file happens in `src/pipeline/render.ts`.
- `renderVideo()` in `src/pipeline/render.ts` stays free of side effects. History is written only in the direct-run block guarded by `isDirectRun`.
- Scene bounds are `MIN_SCENES = 3`, `MAX_SCENES = 8` from `src/services/script-schema.ts`.
- History window: the last **40** entries.
- Series look rules, when writing the niche document: six scenes, roughly 45 seconds, one amber theme colour `#a8903c`, no face ever resolvable, flat understated first-person narration.
- Commit after every task. Do not push.

## File Structure

| File | Responsibility |
|---|---|
| `src/services/cli-args.ts` (modify) | Adds `nicheFile` and `json` to the parsed args; rejects `--niche` together with `--niche-file`. |
| `src/services/cli-args.test.ts` (modify) | Covers both new flags and the conflict. |
| `src/services/script-schema.ts` (modify) | Multi-line niche block, `avoidTopics` lines, and the `youtube` object in the JSON Schema and prompt. |
| `src/services/script-schema.test.ts` (modify) | Covers the block form, the avoid list, and the schema field. |
| `src/types/video.ts` (modify) | Optional `youtube` object on `videoPayloadSchema`. |
| `src/services/result.ts` (create) | Builds the machine-readable run result, including the three metadata fallbacks and the timeline duration. Pure apart from `path`. |
| `src/services/result.test.ts` (create) | Covers the fallbacks, the relative paths, and the duration. |
| `src/services/history.ts` (create) | Reads, appends and windows `history.json`. The only module that touches it. |
| `src/services/history.test.ts` (create) | Covers a missing file, a corrupt file, append, and the 40-entry window. |
| `src/pipeline/render.ts` (modify) | Wires it together: reads the niche file, passes `avoidTopics`, redirects logs under `--json`, prints the result, appends history. |
| `niches/floor-four.md` (create) | The channel definition the script model writes against. |
| `n8n/publish-video.workflow.json` (create) | Importable workflow. |
| `docs/n8n-setup.md` (create) | How to install n8n, import the workflow, and attach credentials. |
| `package.json` (modify) | Registers the two new test files. |
| `README.md` (modify) | Documents the new flags and the automation. |

---

### Task 1: `--niche-file` and `--json` flags

**Files:**
- Modify: `src/services/cli-args.ts`
- Test: `src/services/cli-args.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseArgs(argv: string[])` gains two fields — `nicheFile: string | undefined` and `json: boolean`. Task 6 reads both.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/cli-args.test.ts`:

```ts
test("reads --niche-file as a path", () => {
  assert.equal(parseArgs(["--niche-file", "niches/floor-four.md"]).nicheFile, "niches/floor-four.md");
});

test("nicheFile is undefined when the flag is absent", () => {
  assert.equal(parseArgs(["--topic", "x"]).nicheFile, undefined);
});

test("--niche-file and --niche together are an error", () => {
  assert.throws(
    () => parseArgs(["--niche", "office horror", "--niche-file", "niches/floor-four.md"]),
    /--niche and --niche-file cannot be used together/,
  );
});

test("--niche-file with no value is an error", () => {
  assert.throws(() => parseArgs(["--niche-file"]), /--niche-file requires a value/);
});

test("a niche file path does not leak into the positional topic", () => {
  assert.equal(parseArgs(["--niche-file", "niches/floor-four.md"]).topic, "");
});

test("json is off by default and on with --json", () => {
  assert.equal(parseArgs(["--topic", "x"]).json, false);
  assert.equal(parseArgs(["--topic", "x", "--json"]).json, true);
});

test("--json is not swallowed into the topic", () => {
  assert.equal(parseArgs(["The", "Future", "--json"]).topic, "The Future");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the `nicheFile` assertions report `undefined`, and the conflict test reports "Missing expected exception".

- [ ] **Step 3: Add the flags**

In `src/services/cli-args.ts`, after the existing `const niche = flagValue("--niche");` line, add:

```ts
  const nicheFile = flagValue("--niche-file");

  if (niche !== undefined && nicheFile !== undefined) {
    throw new Error("--niche and --niche-file cannot be used together. The niche file is the niche.");
  }
```

Add `"--json"` to the list of bare flags the positional filter skips, so it sits with the others:

```ts
  const positional = argv
    .filter(
      (arg, i) =>
        !consumedIndices.has(i) &&
        arg !== "--no-audio" &&
        arg !== "--no-images" &&
        arg !== "--no-music" &&
        arg !== "--no-cover" &&
        arg !== "--no-loudness" &&
        arg !== "--json" &&
        arg !== "--",
    )
    .join(" ")
    .trim();
```

And extend the returned object:

```ts
  return {
    payloadFile,
    topic: topicFlag ?? positional,
    niche,
    nicheFile,
    sceneCount,
    audio: !argv.includes("--no-audio"),
    images: !argv.includes("--no-images"),
    music: !argv.includes("--no-music"),
    cover: !argv.includes("--no-cover"),
    loudness: !argv.includes("--no-loudness"),
    json: argv.includes("--json"),
  };
```

Note the ordering: `flagValue("--niche-file")` must run before the positional filter, so its value is in `consumedIndices` and cannot be read as a topic. That is why it goes beside the other `flagValue` calls rather than at the bottom.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/services/cli-args.ts src/services/cli-args.test.ts
git commit -m "Take the niche from a file and the result as JSON"
```

---

### Task 2: A niche document and an avoid list in the prompt

**Files:**
- Modify: `src/services/script-schema.ts`
- Test: `src/services/script-schema.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ScriptBrief` gains `avoidTopics?: string[]`. `buildScriptPrompt(brief)` renders a multi-line niche as a fenced block and appends the avoid list. Task 6 populates `avoidTopics`.

**Why:** `briefLines()` today writes `niche: "${niche}"`. A whole Markdown document interpolated into a quoted sentence reads as one runaway string literal, and its own line breaks make the quoting ambiguous to the model. A document gets a document's shape.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/script-schema.test.ts`:

```ts
test("a single-line niche stays in a quoted sentence", () => {
  const prompt = buildScriptPrompt({ niche: "stoic philosophy" });

  assert.match(prompt, /niche: "stoic philosophy"/);
});

test("a multi-line niche is rendered as its own block", () => {
  const niche = "# Office horror\n\nFirst person, flat delivery.\nNo faces.";
  const prompt = buildScriptPrompt({ niche });

  assert.match(prompt, /The channel is defined by this brief:/);
  assert.ok(prompt.includes(niche), "the brief text appears verbatim");
  assert.doesNotMatch(prompt, /niche: "# Office horror/);
});

test("a multi-line niche still asks the model to pick the topic", () => {
  const prompt = buildScriptPrompt({ niche: "# Office horror\n\nFirst person." });

  assert.match(prompt, /Pick one specific, high-engagement topic/);
});

test("avoid topics are listed as things not to repeat", () => {
  const prompt = buildScriptPrompt({
    niche: "office horror",
    avoidTopics: ["There Is No Fourth Floor", "I Pressed Four"],
  });

  assert.match(prompt, /already been published/);
  assert.match(prompt, /There Is No Fourth Floor/);
  assert.match(prompt, /I Pressed Four/);
});

test("an empty avoid list adds nothing to the prompt", () => {
  const withList = buildScriptPrompt({ niche: "office horror", avoidTopics: [] });
  const without = buildScriptPrompt({ niche: "office horror" });

  assert.equal(withList, without);
});
```

If `buildScriptPrompt` is not already imported at the top of that file, add it to the existing import from `./script-schema`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/services/script-schema.test.ts`
Expected: FAIL — the multi-line test finds `niche: "# Office horror`, and the avoid-list test finds no match for `already been published`.

- [ ] **Step 3: Implement the block form and the avoid list**

In `src/services/script-schema.ts`, extend the type:

```ts
/** What a run is asking for. At least one of `topic` or `niche` is set by the CLI. */
export type ScriptBrief = {
  topic?: string;
  niche?: string;
  sceneCount?: number;
  /** Titles already published on this channel. The model is told not to repeat them. */
  avoidTopics?: string[];
};
```

Replace `briefLines` with a version that branches on shape:

```ts
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
```

Add the avoid list:

```ts
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
```

And place it in `buildScriptPrompt`, after the brief lines and before the scene count line:

```ts
export function buildScriptPrompt(brief: ScriptBrief) {
  return [
    ...briefLines(brief),
    ...avoidLines(brief.avoidTopics),
    sceneCountLine(brief.sceneCount),
    "short subtitles, vibrant six-digit hex theme colors, and a 9:16 aspect ratio.",
```

The remainder of `buildScriptPrompt` is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. The existing single-line niche tests must still pass untouched — that branch is unchanged.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run build
git add src/services/script-schema.ts src/services/script-schema.test.ts
git commit -m "Let the niche be a document and name what not to repeat"
```

---

### Task 3: `youtube` metadata on the payload

**Files:**
- Modify: `src/types/video.ts`
- Modify: `src/services/script-schema.ts`
- Test: `src/services/script-schema.test.ts`

**Interfaces:**
- Consumes: `buildVideoPayloadJsonSchema(sceneCount?: number)` from Task 2's file, unchanged in signature.
- Produces: `VideoPayload.youtube?: { title: string; description: string; tags: string[] }`. Task 4 reads it.

**Why:** the model that decided what the video says is the one that knows how to sell it. A second LLM call in n8n would be a second author, and the two would drift.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/script-schema.test.ts`:

```ts
test("the JSON schema requires a youtube block", () => {
  const schema = buildVideoPayloadJsonSchema() as {
    required: string[];
    properties: { youtube: { required: string[] } };
  };

  assert.ok(schema.required.includes("youtube"));
  assert.deepEqual(schema.properties.youtube.required, ["title", "description", "tags"]);
});

test("the prompt asks for youtube metadata", () => {
  const prompt = buildScriptPrompt({ topic: "The fourth floor" });

  assert.match(prompt, /youtube\.title/);
  assert.match(prompt, /youtube\.description/);
  assert.match(prompt, /youtube\.tags/);
});

test("a payload without a youtube block is still valid", () => {
  const payload = parseScriptJson(
    JSON.stringify({
      title: "T",
      fps: 30,
      aspectRatio: "9:16",
      scenes: [{ id: "1", text: "a", subtext: "", narration: "n", durationInFrames: 90, themeColor: "#a8903c", keywords: [], imagePrompt: "p" }],
    }),
  );

  assert.equal(payload.youtube, undefined);
});

test("a youtube block round-trips through validation", () => {
  const payload = parseScriptJson(
    JSON.stringify({
      title: "T",
      fps: 30,
      aspectRatio: "9:16",
      youtube: { title: "There Is No Fourth Floor", description: "d", tags: ["horror"] },
      scenes: [{ id: "1", text: "a", subtext: "", narration: "n", durationInFrames: 90, themeColor: "#a8903c", keywords: [], imagePrompt: "p" }],
    }),
  );

  assert.equal(payload.youtube?.title, "There Is No Fourth Floor");
  assert.deepEqual(payload.youtube?.tags, ["horror"]);
});
```

Ensure `buildVideoPayloadJsonSchema` and `parseScriptJson` are in the import list at the top of that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/services/script-schema.test.ts`
Expected: FAIL — `schema.properties.youtube` is `undefined`.

- [ ] **Step 3: Add the field to the payload type**

In `src/types/video.ts`, add to `videoPayloadSchema`, after `aspectRatio`:

```ts
  // How the video is listed once it is uploaded. Written by the script model,
  // which is also the author of what the video says — a second model writing
  // the listing would be a second author, and the two would drift.
  // Optional in zod so a hand-written payload stays valid; required in the JSON
  // Schema the model is handed, so a generated script always carries one.
  youtube: z
    .object({
      title: z.string(),
      description: z.string(),
      tags: z.array(z.string()).default([]),
    })
    .optional(),
```

- [ ] **Step 4: Add it to the JSON Schema and the prompt**

In `src/services/script-schema.ts`, inside `buildVideoPayloadJsonSchema`, add to `properties` after `aspectRatio`:

```ts
      youtube: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "Title read cold in a feed, under 70 characters" },
          description: { type: "string", description: "Two or three sentences for someone deciding whether to watch" },
          tags: { type: "array", items: { type: "string" }, description: "Search terms, not adjectives" },
        },
        required: ["title", "description", "tags"],
      },
```

and change the top-level `required` to:

```ts
    required: ["title", "fps", "aspectRatio", "youtube", "scenes"],
```

Then, in `buildScriptPrompt`, insert these lines immediately before the `"Respond with JSON matching this schema:"` line:

```ts
    "Write `youtube.title` to be read cold in a feed by someone who has never seen this channel:",
    "under 70 characters, concrete, no clickbait punctuation and no emoji.",
    "Write `youtube.description` for someone deciding whether to watch: two or three sentences,",
    "no timestamps and no links.",
    "Write `youtube.tags` as six to ten search terms someone would actually type. Terms, not adjectives.",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run build
git add src/types/video.ts src/services/script-schema.ts src/services/script-schema.test.ts
git commit -m "Have the script model write the listing too"
```

---

### Task 4: The run result

**Files:**
- Create: `src/services/result.ts`
- Test: `src/services/result.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `VideoPayload` from `src/types/video.ts` including Task 3's `youtube` field; `timelineFrames` and `transitionFrames` from `src/services/timing.ts`.
- Produces:
  - `type RunResult = { ok: true; mp4: string; cover?: string; slug: string; title: string; description: string; tags: string[]; durationSeconds: number }`
  - `type RunFailure = { ok: false; error: string }`
  - `buildResult(args: { payload: VideoPayload; videoLocation: string; coverLocation?: string; rootDir: string }): RunResult`
  - `videoDurationSeconds(payload: VideoPayload): number`

  Task 6 calls `buildResult` and prints it.

- [ ] **Step 1: Write the failing test**

Create `src/services/result.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildResult, videoDurationSeconds } from "./result";
import type { VideoPayload } from "../types/video";

const rootDir = path.resolve("/repo");

function payload(overrides: Partial<VideoPayload> = {}): VideoPayload {
  return {
    title: "Please Do Not Press Four",
    fps: 30,
    aspectRatio: "9:16",
    scenes: [
      {
        id: "1",
        text: "a",
        subtext: "",
        narration: "The fire map goes three, then five.",
        durationInFrames: 120,
        themeColor: "#a8903c",
        keywords: ["office", "horror"],
        imagePrompt: "p",
      },
      {
        id: "2",
        text: "b",
        subtext: "",
        narration: "The lift stops there anyway.",
        durationInFrames: 90,
        themeColor: "#a8903c",
        keywords: ["horror", "lift"],
        imagePrompt: "p",
      },
    ],
    ...overrides,
  } as VideoPayload;
}

test("the result carries repo-relative forward-slash paths", () => {
  const result = buildResult({
    payload: payload(),
    videoLocation: path.join(rootDir, "out", "i-pressed-four.mp4"),
    coverLocation: path.join(rootDir, "out", "i-pressed-four.jpg"),
    rootDir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mp4, "out/i-pressed-four.mp4");
  assert.equal(result.cover, "out/i-pressed-four.jpg");
  assert.equal(result.slug, "i-pressed-four");
});

test("a run with no cover omits the field", () => {
  const result = buildResult({
    payload: payload(),
    videoLocation: path.join(rootDir, "out", "x.mp4"),
    rootDir,
  });

  assert.equal(result.cover, undefined);
});

test("youtube metadata is used when the model wrote it", () => {
  const result = buildResult({
    payload: payload({
      youtube: { title: "I Pressed Four", description: "The last one.", tags: ["officehorror"] },
    }),
    videoLocation: path.join(rootDir, "out", "x.mp4"),
    rootDir,
  });

  assert.equal(result.title, "I Pressed Four");
  assert.equal(result.description, "The last one.");
  assert.deepEqual(result.tags, ["officehorror"]);
});

test("a payload without youtube metadata falls back to the payload itself", () => {
  const result = buildResult({
    payload: payload(),
    videoLocation: path.join(rootDir, "out", "x.mp4"),
    rootDir,
  });

  assert.equal(result.title, "Please Do Not Press Four");
  assert.equal(result.description, "The fire map goes three, then five. The lift stops there anyway.");
  assert.deepEqual(result.tags, ["office", "horror", "lift"]);
});

test("the duration accounts for the transition overlap", () => {
  // 120 + 90 frames at 30fps is 7s laid end to end; one 0.3s dissolve takes 9 frames back.
  assert.equal(videoDurationSeconds(payload()), 6.7);
});

test("a single-scene payload has no overlap to subtract", () => {
  const single = payload();
  single.scenes = [single.scenes[0]];

  assert.equal(videoDurationSeconds(single), 4);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/services/result.test.ts`
Expected: FAIL — "Cannot find module './result'".

- [ ] **Step 3: Write the implementation**

Create `src/services/result.ts`:

```ts
import path from "node:path";
import type { VideoPayload } from "../types/video";
import { timelineFrames, transitionFrames } from "./timing";

/**
 * What a `--json` run prints on success.
 *
 * This is the whole contract with whatever automates the CLI: paths are
 * repo-relative with forward slashes so they read the same on every platform,
 * and the listing fields are resolved here rather than by the caller, so no
 * consumer has to know that `youtube` is optional.
 */
export type RunResult = {
  ok: true;
  mp4: string;
  cover?: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  durationSeconds: number;
};

/** What a `--json` run prints when a stage aborted the render. */
export type RunFailure = {
  ok: false;
  error: string;
};

/** Repo-relative, forward-slashed, so a Windows path does not arrive full of backslashes. */
function relativePath(rootDir: string, target: string) {
  return path.relative(rootDir, target).split(path.sep).join("/");
}

/** Keeps the first occurrence of each keyword, so the order stays the scene order. */
function uniqueKeywords(payload: VideoPayload) {
  return [...new Set(payload.scenes.flatMap((scene) => scene.keywords))];
}

/**
 * How long the finished video runs.
 *
 * Not the sum of the scene durations: consecutive scenes overlap by the
 * dissolve, so the timeline is shorter than its parts. `timing.ts` is the one
 * place that arithmetic lives and this reuses it rather than restating it.
 */
export function videoDurationSeconds(payload: VideoPayload): number {
  const durations = payload.scenes.map((scene) => scene.durationInFrames);
  const frames = timelineFrames(durations, transitionFrames(payload.fps));

  return Number((frames / payload.fps).toFixed(2));
}

/**
 * Assembles the result object from a finished render.
 *
 * The three fallbacks matter: a hand-written payload carries no `youtube`
 * block, and it must still be uploadable. Title falls back to the payload
 * title, description to the narration read end to end — which is, after all,
 * exactly what the video says — and tags to the scene keywords.
 */
export function buildResult({
  payload,
  videoLocation,
  coverLocation,
  rootDir,
}: {
  payload: VideoPayload;
  videoLocation: string;
  coverLocation?: string;
  rootDir: string;
}): RunResult {
  const narration = payload.scenes
    .map((scene) => scene.narration.trim())
    .filter(Boolean)
    .join(" ");

  return {
    ok: true,
    mp4: relativePath(rootDir, videoLocation),
    ...(coverLocation ? { cover: relativePath(rootDir, coverLocation) } : {}),
    slug: path.basename(videoLocation, path.extname(videoLocation)),
    title: payload.youtube?.title || payload.title,
    description: payload.youtube?.description || narration,
    tags: payload.youtube?.tags?.length ? payload.youtube.tags : uniqueKeywords(payload),
    durationSeconds: videoDurationSeconds(payload),
  };
}
```

- [ ] **Step 4: Register the test file**

In `package.json`, append ` src/services/result.test.ts` to the end of the `test` script's file list.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, and the run must now name `result.test.ts` among the files.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run build
git add src/services/result.ts src/services/result.test.ts package.json
git commit -m "Describe a finished render in one object"
```

---

### Task 5: The published-title history

**Files:**
- Create: `src/services/history.ts`
- Test: `src/services/history.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type HistoryEntry = { date: string; slug: string; title: string; topic: string }`
  - `const HISTORY_LIMIT = 40`
  - `historyPath(rootDir: string): string`
  - `readHistory(rootDir: string): Promise<HistoryEntry[]>`
  - `appendHistory(rootDir: string, entry: HistoryEntry): Promise<void>`
  - `recentTitles(entries: HistoryEntry[], limit?: number): string[]`

  Task 6 calls `readHistory` before generating and `appendHistory` after rendering.

- [ ] **Step 1: Write the failing test**

Create `src/services/history.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HISTORY_LIMIT, appendHistory, historyPath, readHistory, recentTitles } from "./history";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "history-"));
}

test("a missing history file reads as an empty list", async () => {
  const root = await tempRoot();

  assert.deepEqual(await readHistory(root), []);
});

test("a corrupt history file reads as an empty list rather than failing a render", async () => {
  const root = await tempRoot();
  await fs.writeFile(historyPath(root), "{ not json", "utf8");

  assert.deepEqual(await readHistory(root), []);
});

test("a history file holding something other than a list reads as empty", async () => {
  const root = await tempRoot();
  await fs.writeFile(historyPath(root), '{"date":"2026-09-01"}', "utf8");

  assert.deepEqual(await readHistory(root), []);
});

test("append writes an entry that reads back", async () => {
  const root = await tempRoot();
  await appendHistory(root, { date: "2026-09-01", slug: "i-pressed-four", title: "I Pressed Four", topic: "office horror" });

  const entries = await readHistory(root);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "I Pressed Four");
});

test("append keeps earlier entries and adds to the end", async () => {
  const root = await tempRoot();
  await appendHistory(root, { date: "2026-09-01", slug: "a", title: "A", topic: "t" });
  await appendHistory(root, { date: "2026-09-02", slug: "b", title: "B", topic: "t" });

  assert.deepEqual((await readHistory(root)).map((entry) => entry.slug), ["a", "b"]);
});

test("recent titles are the last entries, newest last", () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    date: "2026-09-01",
    slug: `s${i}`,
    title: `T${i}`,
    topic: "t",
  }));

  const titles = recentTitles(entries);

  assert.equal(titles.length, HISTORY_LIMIT);
  assert.equal(titles[0], "T10");
  assert.equal(titles[titles.length - 1], "T49");
});

test("recent titles of a short history is the whole history", () => {
  assert.deepEqual(
    recentTitles([{ date: "d", slug: "s", title: "Only One", topic: "t" }]),
    ["Only One"],
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/services/history.test.ts`
Expected: FAIL — "Cannot find module './history'".

- [ ] **Step 3: Write the implementation**

Create `src/services/history.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";

/** One published video, as the next run needs to know about it. */
export type HistoryEntry = {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  slug: string;
  title: string;
  /** The topic or niche the run was given. Empty for a rendered payload file. */
  topic: string;
};

/**
 * How many past titles go into the next prompt.
 *
 * Enough that a fixed niche has to keep finding new ground, short enough that
 * the list does not crowd out the brief itself.
 */
export const HISTORY_LIMIT = 40;

export function historyPath(rootDir: string): string {
  return path.join(rootDir, "history.json");
}

/**
 * Reads the history, treating every failure as "no history".
 *
 * A missing file is the normal first run. A corrupt one is a file someone
 * hand-edited, and refusing to render over it would trade a whole video for a
 * bad line of JSON — the cost of an empty list is one possible repeat.
 */
export async function readHistory(rootDir: string): Promise<HistoryEntry[]> {
  let raw: string;

  try {
    raw = await fs.readFile(historyPath(rootDir), "utf8");
  } catch {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    console.warn("[history] history.json is not valid JSON, continuing without it");
    return [];
  }
}

/** Appends one entry. The whole file is rewritten: it holds tens of lines, not thousands. */
export async function appendHistory(rootDir: string, entry: HistoryEntry): Promise<void> {
  const entries = await readHistory(rootDir);
  entries.push(entry);

  await fs.writeFile(historyPath(rootDir), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

/** The titles the next prompt is told not to repeat, oldest first. */
export function recentTitles(entries: HistoryEntry[], limit = HISTORY_LIMIT): string[] {
  return entries.slice(-limit).map((entry) => entry.title);
}
```

- [ ] **Step 4: Register the test file**

In `package.json`, append ` src/services/history.test.ts` to the end of the `test` script's file list.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run build
git add src/services/history.ts src/services/history.test.ts package.json
git commit -m "Remember what the channel has already published"
```

---

### Task 6: Wire it into the render entry point

**Files:**
- Modify: `src/pipeline/render.ts`

**Interfaces:**
- Consumes: `parseArgs` (Task 1, fields `nicheFile` and `json`); `ScriptBrief.avoidTopics` (Task 2); `buildResult` and `RunFailure` (Task 4); `readHistory`, `recentTitles`, `appendHistory` (Task 5).
- Produces: the CLI contract itself. Nothing later depends on it in code.

**Why the stdout redirect:** the Execute Command node in n8n exposes stdout and stderr separately, so a clean stdout means the workflow parses the whole of it with `JSON.parse` instead of hunting for the last line that happens to look like JSON. Patching `process.stdout.write` rather than only `console.log` is deliberate: the render logs are ours, but any library that writes straight to the stream would otherwise corrupt the contract.

- [ ] **Step 1: Add the imports**

At the top of `src/pipeline/render.ts`, alongside the existing imports:

```ts
import { buildResult, type RunFailure } from "../services/result";
import { appendHistory, readHistory, recentTitles } from "../services/history";
```

- [ ] **Step 2: Replace the direct-run block**

Replace everything from `if (isDirectRun) {` to the end of the file with:

```ts
if (isDirectRun) {
  /**
   * Under --json, stdout carries the result object and nothing else.
   *
   * Everything that would have gone to stdout is pushed to stderr for the
   * duration of the run — including anything a library writes to the stream
   * directly — and the result is written through this saved reference at the
   * end. A caller parses the whole of stdout; a person reads stderr.
   */
  const stdoutWrite = process.stdout.write.bind(process.stdout);

  const run = async () => {
    const { topic, niche, nicheFile, sceneCount, payloadFile, audio, images, music, cover, loudness, json } =
      parseArgs(process.argv.slice(2));

    if (json) {
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
        (process.stderr.write as (...args: never[]) => boolean)(
          chunk as never,
          ...(rest as never[]),
        )) as typeof process.stdout.write;
    }

    let briefNiche = niche;

    if (nicheFile) {
      const resolved = path.resolve(process.cwd(), nicheFile);

      try {
        briefNiche = await fs.readFile(resolved, "utf8");
      } catch {
        throw new Error(`Could not read niche file: ${resolved}`);
      }

      if (!briefNiche.trim()) {
        throw new Error(`The niche file is empty: ${resolved}`);
      }
    }

    // A payload file names its own video; the avoid list only shapes a
    // generated script, so it is not read on that path.
    const avoidTopics = payloadFile ? undefined : recentTitles(await readHistory(rootDir));
    const brief: ScriptBrief = { topic, niche: briefNiche, sceneCount, avoidTopics };

    let payload: VideoPayload | undefined;

    if (payloadFile) {
      payload = await loadPayloadFile(payloadFile);
      console.log(`Rendering payload from ${payloadFile}`);
    } else {
      if (!topic && !briefNiche) {
        throw new Error(
          "A topic or a niche must be provided via --topic, --niche or --niche-file, or a script via --payload <file.json>",
        );
      }

      const provider = process.env.SCRIPT_PROVIDER || defaultProvider;
      const subject = topic ? `topic: ${topic}` : nicheFile ? `niche file: ${nicheFile}` : `niche: ${briefNiche}`;
      const scenes = sceneCount ? `, ${sceneCount} scenes` : "";
      const avoiding = avoidTopics?.length ? `, avoiding ${avoidTopics.length} published titles` : "";
      console.log(`Generating video for ${subject} (provider: ${provider}${scenes}${avoiding})`);
    }

    const result = await renderVideo(brief, payload, { audio, images, music, cover, loudness });

    console.log(`Render complete: ${result.outputLocation}`);

    if (result.coverLocation) {
      console.log(`Cover: ${result.coverLocation}`);
    }

    const summary = buildResult({
      payload: result.payload,
      videoLocation: result.outputLocation,
      coverLocation: result.coverLocation,
      rootDir,
    });

    // Only a generated script goes in the history: a payload file was written
    // by hand, and its topic was never the model's to choose again.
    if (!payloadFile) {
      await appendHistory(rootDir, {
        date: new Date().toISOString().slice(0, 10),
        slug: summary.slug,
        title: summary.title,
        topic: topic || nicheFile || "",
      });
    }

    if (json) {
      stdoutWrite(`${JSON.stringify(summary)}\n`);
    }
  };

  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    console.error("Render failed:", message);

    if (process.argv.includes("--json")) {
      const failure: RunFailure = { ok: false, error: message };
      stdoutWrite(`${JSON.stringify(failure)}\n`);
    }

    process.exitCode = 1;
  });
}
```

`process.argv.includes("--json")` is read again in the catch rather than closed over, because `parseArgs` itself may be what threw — a bad `--scenes` value, or `--niche` and `--niche-file` together — and the failure still has to come back as JSON.

- [ ] **Step 3: Verify the offline path still renders**

Run: `npm run start -- --payload scripts/example-payload.json --no-audio`
Expected: the familiar progress logs and `Render complete: …out/…mp4`. No `history.json` is written — this is a payload run.

- [ ] **Step 4: Verify the JSON contract**

Run, from the repo root in PowerShell:

```powershell
npm run start -- --payload scripts/example-payload.json --no-audio --json 1>result.json 2>render.log
Get-Content result.json | ConvertFrom-Json
```

Expected: `result.json` parses on its own and holds `ok`, `mp4`, `cover`, `slug`, `title`, `description`, `tags`, `durationSeconds`. `render.log` holds the `[render] N% complete` lines. If `result.json` contains anything before the `{`, the stdout patch is not covering whatever wrote it — widen the patch, do not loosen the contract.

Then delete both: `Remove-Item result.json, render.log`.

- [ ] **Step 5: Verify a failure comes back as JSON**

Run:

```powershell
npm run start -- --niche "x" --niche-file "niches/nothing.md" --json 1>fail.json 2>$null
$LASTEXITCODE
Get-Content fail.json
```

Expected: exit code 1, and `fail.json` holding `{"ok":false,"error":"--niche and --niche-file cannot be used together. The niche file is the niche."}`. Then `Remove-Item fail.json`.

- [ ] **Step 6: Run the full suite, typecheck and commit**

```bash
npm test
npm run build
git add src/pipeline/render.ts
git commit -m "Give a run a machine-readable result"
```

---

### Task 7: The niche document, the workflow and the docs

**Files:**
- Create: `niches/floor-four.md`
- Create: `n8n/publish-video.workflow.json`
- Create: `docs/n8n-setup.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the `--niche-file` and `--json` contract from Tasks 1, 4 and 6.
- Produces: nothing in code.

- [ ] **Step 1: Write the niche document**

Create `niches/floor-four.md`. It distils what `scripts/floor-four-publishing.md` and the rendered parts already establish, so a generated script sits beside the hand-written ones without looking like a different channel:

```markdown
# Office horror, first person

Short vertical horror set in ordinary workplaces — lifts, stairwells, badge
readers, car parks, night shifts. The frightening thing is always a detail of
the building that does not add up, noticed by someone who works there and has
no reason to be dramatic about it.

## Voice

First person, past tense, flat and understated. The narrator is an employee,
not a storyteller: they describe what they saw the way someone describes it to
a colleague at lunch. No exclamations, no "suddenly", no telling the viewer to
be scared. The delivery stays level even at the worst moment — that is the
effect.

## Shape

Six scenes, roughly forty five seconds. Open on the detail, not on a warning.
Establish the ordinary rule of the building, show the thing that breaks it,
narrow to the narrator's own position inside it, and end on a line that hands
the viewer something to do or check.

## Look

One amber theme colour, `#a8903c`, across every scene. Fluorescent institutional
light, analog film grain, worn carpet and painted concrete. No face is ever
resolvable — figures are seen at distance, from behind, in reflection, or out of
frame entirely. No text or lettering in the generated pictures.

## Rules

- Nothing supernatural is ever explained or named.
- No jump scare and no gore. The horror is administrative.
- No real company, building or person.
- The last line is the hook for a rewatch, not a summary.

## Listing

Titles read cold in a feed and state the strange fact plainly rather than
teasing it. Descriptions are two or three sentences in the narrator's own
register. Tags stay in this territory: horrorstories, scarystories,
liminalspaces, officehorror, creepy.
```

- [ ] **Step 2: Commit the niche document**

```bash
git add niches/floor-four.md
git commit -m "Write the channel down as a brief"
```

- [ ] **Step 3: Verify the niche file actually drives a render**

This step costs one real API call and one real render. Run it once:

```bash
npm run start -- --niche-file niches/floor-four.md --scenes 6 --json 1>result.json 2>render.log
```

Expected: `result.json` parses, its `title` reads as a feed title rather than the on-screen title, and `history.json` now exists at the repo root with one entry. Watch the MP4 in `out/` before moving on — this is the first output of the automated path and the only chance to catch a niche document that reads badly to the model.

Then `git add history.json` and commit it with the render you kept, or delete both the entry and the output if the result was not worth keeping.

- [ ] **Step 4: Write the workflow**

Create `n8n/publish-video.workflow.json`:

```json
{
  "name": "Publish a video",
  "nodes": [
    {
      "parameters": {
        "rule": { "interval": [{ "field": "weeks", "triggerAtDay": [1], "triggerAtHour": 9 }] }
      },
      "id": "schedule",
      "name": "Weekly",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 0]
    },
    {
      "parameters": {
        "command": "npm run start -- --niche-file niches/floor-four.md --scenes 6 --json"
      },
      "id": "render",
      "name": "Render",
      "type": "n8n-nodes-base.executeCommand",
      "typeVersion": 1,
      "position": [220, 0],
      "notes": "Set the working directory to the repo root in the node's settings."
    },
    {
      "parameters": {
        "jsCode": "const raw = $json.stdout ?? '';\nlet result;\ntry {\n  result = JSON.parse(raw);\n} catch {\n  throw new Error('The render did not return JSON. stderr: ' + ($json.stderr ?? '').slice(-800));\n}\nif (!result.ok) {\n  throw new Error(result.error);\n}\nreturn [{ json: result }];"
      },
      "id": "parse",
      "name": "Read the result",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [440, 0]
    },
    {
      "parameters": {
        "filePath": "={{ $json.mp4 }}",
        "options": { "dataPropertyName": "data" }
      },
      "id": "readvideo",
      "name": "Read the video",
      "type": "n8n-nodes-base.readBinaryFile",
      "typeVersion": 1,
      "position": [660, 0]
    },
    {
      "parameters": {
        "resource": "video",
        "operation": "upload",
        "title": "={{ $('Read the result').item.json.title }}",
        "regionCode": "US",
        "categoryId": "24",
        "options": {
          "description": "={{ $('Read the result').item.json.description }}",
          "tags": "={{ $('Read the result').item.json.tags.join(',') }}",
          "privacyStatus": "private",
          "selfDeclaredMadeForKids": false
        }
      },
      "id": "upload",
      "name": "Upload to YouTube",
      "type": "n8n-nodes-base.youTube",
      "typeVersion": 1,
      "position": [880, 0]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "=https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={{ $json.id }}",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "youTubeOAuth2Api",
        "sendBody": true,
        "contentType": "binaryData",
        "inputDataFieldName": "data",
        "options": {}
      },
      "id": "thumbnail",
      "name": "Set the cover",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1320, 0]
    },
    {
      "parameters": {
        "text": "=Ready: {{ $('Read the result').item.json.title }}\nhttps://youtube.com/watch?v={{ $('Upload to YouTube').item.json.id }}\n{{ $('Read the result').item.json.durationSeconds }}s, private. Review it before publishing.",
        "additionalFields": {}
      },
      "id": "notify",
      "name": "Tell me",
      "type": "n8n-nodes-base.telegram",
      "typeVersion": 1.2,
      "position": [1540, 0]
    }
  ],
  "connections": {
    "Weekly": { "main": [[{ "node": "Render", "type": "main", "index": 0 }]] },
    "Render": { "main": [[{ "node": "Read the result", "type": "main", "index": 0 }]] },
    "Read the result": { "main": [[{ "node": "Read the video", "type": "main", "index": 0 }]] },
    "Read the video": { "main": [[{ "node": "Upload to YouTube", "type": "main", "index": 0 }]] },
    "Upload to YouTube": { "main": [[{ "node": "Set the cover", "type": "main", "index": 0 }]] },
    "Set the cover": { "main": [[{ "node": "Tell me", "type": "main", "index": 0 }]] }
  },
  "settings": { "executionOrder": "v1" }
}
```

Between "Upload to YouTube" and "Set the cover" the cover file still has to be read. Add that node in the n8n editor after importing — a **Read Binary File** node with `filePath` set to `={{ $('Read the result').item.json.cover }}` and the data property `data` — and re-link the two edges through it. It is left out of the JSON because it reads a file that may be absent when `--no-cover` was used, and the branch is clearer drawn by hand than described here.

- [ ] **Step 5: Write the setup guide**

Create `docs/n8n-setup.md`:

```markdown
# Running the pipeline from n8n

The workflow in `n8n/publish-video.workflow.json` produces one video a week and
uploads it to YouTube as a private draft. It generates nothing itself: it calls
`npm run start -- --json` once and reads the result.

## Install n8n natively

```powershell
npm install -g n8n
n8n start
```

Then open http://localhost:5678.

Not in Docker. The Execute Command node has to see this repo, this Node
installation and ffmpeg, and inside a container it sees none of them. The cost
is that videos are only produced while this machine is on.

## Import and wire

1. **Workflows → Import from file** → `n8n/publish-video.workflow.json`.
2. Open the **Render** node and set its working directory to the repo root.
3. Add the missing **Read Binary File** node for the cover between
   **Upload to YouTube** and **Set the cover**, with the file path
   `={{ $('Read the result').item.json.cover }}` and the data property `data`.

## Credentials

Both live in n8n, not in `.env`. The repo never reads them.

**YouTube OAuth2.** Create a Google Cloud project, enable the YouTube Data API
v3, create an OAuth client of type "Web application", and add n8n's callback URL
as an authorised redirect URI. Attach the credential to both the
**Upload to YouTube** node and the **Set the cover** node.

An upload costs 1600 units against a default 10,000/day, so roughly six videos a
day. A weekly run is nowhere near it.

**Telegram.** Create a bot with @BotFather, take the token, and message the bot
once so it can reply to you. Set the chat id on the **Tell me** node.

## What it does on failure

A failing production stage aborts the render, the CLI exits non-zero with
`{"ok":false,"error":"…"}`, and the Code node throws before anything is
uploaded. Nothing partial ever reaches YouTube. Add an **Error Trigger**
workflow with a Telegram node to be told when that happens.

There is no automatic retry. Script and render failures here are deterministic —
a bad model name, a missing key, an unaccepted speech model — and running them
again produces the same error a minute later.

## Rendering a hand-written series instead

The current series is rendered from payload files, not from a niche. The same
workflow publishes those: change the Render node's command to

```
npm run start -- --payload scripts/floor-four-part-3.json --json
```

Payload runs are not written to `history.json` — that list exists to stop the
model repeating itself, and a hand-written script was never its choice.
```

- [ ] **Step 6: Document the flags in the README**

In `README.md`, add two rows to the CLI flag table, after the `--payload` row:

```markdown
| `--niche-file <file>` | Read the niche from a Markdown file instead of `--niche`. The file is the channel definition; see `niches/`. Cannot be combined with `--niche`. |
| `--json` | Print the run result as one JSON object on stdout and send every log to stderr. For automation; see `docs/n8n-setup.md`. |
```

And update the usage line above the table to include them:

```markdown
npm run start -- [--topic <topic>] [--niche <niche>] [--niche-file <file.md>] [--scenes <n>] [--payload <file.json>] [--json] [--no-audio] [--no-images] [--no-music] [--no-cover] [--no-loudness]
```

Then add a section after **Configuration**:

```markdown
## Automation

`docs/n8n-setup.md` covers running the pipeline on a schedule from n8n: one
weekly run that generates a video from a niche document and uploads it to
YouTube as a private draft. n8n orchestrates and this repo produces — the
contract between them is `--json`, which puts a single result object on stdout
and every log on stderr.

Two files support it. `niches/*.md` defines a channel — voice, shape, look and
rules — and is passed with `--niche-file`. `history.json` records every
generated video's title, and the next run is told not to repeat them, because a
model asked to pick its own topic from a fixed niche will otherwise return to
the same few ideas within a month.
```

- [ ] **Step 7: Commit**

```bash
git add n8n docs/n8n-setup.md README.md
git commit -m "Document and package the n8n workflow"
```

- [ ] **Step 8: Run the workflow once by hand**

In the n8n editor, click **Test workflow**. Expected: the video appears in
YouTube Studio as private, with the generated title, description and tags, the
cover set as its thumbnail, and a Telegram message carrying the link.

If the upload node fails on scopes, the OAuth credential needs
`https://www.googleapis.com/auth/youtube.upload` — reconnect it rather than
working around it.

---

## Verification

After Task 7, the whole of it:

```bash
npm test        # every suite, including result and history
npm run build   # typecheck
npm run start -- --payload scripts/example-payload.json --no-audio --json 1>result.json 2>render.log
```

`result.json` must parse on its own, `render.log` must hold the progress lines,
and `npm run start -- --topic "x" --no-audio` must still behave exactly as it
did before any of this — the hand-run path is unchanged by design.
