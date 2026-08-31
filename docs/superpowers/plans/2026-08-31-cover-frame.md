# Cover Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a thumbnail, `out/<slug>.jpg`, beside every rendered video — a purpose-built still, not a frame lifted from the video.

**Architecture:** A second Remotion composition, `AI-Cover`, one frame long, drawn by `src/components/Cover.tsx` from a pure plan computed in `src/services/cover.ts`. `src/pipeline/render.ts` renders it with `renderStill` from the same `serveUrl` the video came from, after the video is written, inside a catch.

**Tech Stack:** TypeScript ES modules, Node 22 (`node:test`), Remotion 4, React 19, tsx, Zod 4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-31-cover-frame-design.md`. Branch: `feature/cover-frame`.
- **Never modify `src/services/gemini.ts`.**
- **No new dependency.** `renderStill` already ships in `@remotion/renderer`.
- `src/services/cover.ts` and `src/components/Cover.tsx` are bundled for the browser: they must not import `node:*` modules or `dotenv`.
- All prose, comments, log lines and commit messages in **English**.
- Tests use `node:test` + `node:assert/strict` and make no network calls.
- Register every new test file in the `test` script in `package.json`.
- Commit after every task with a plain, imperative subject line.

---

### Task 1: The cover plan

**Files:**
- Create: `src/services/cover.ts`
- Create: `src/services/cover.test.ts`
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Consumes: `VideoPayload` from `../types/video`.
- Produces:
  - `type CoverPlan = { imageSrc?: string; themeColor: string; headline: string; kicker: string }`
  - `coverPlan(payload: VideoPayload): CoverPlan`
  - `coverHeadlineSize(headline: string): number`
  - `COVER_HEADLINE_MAX: number` (132), `COVER_HEADLINE_MIN: number` (84)

- [ ] **Step 1: Write the failing tests**

Create `src/services/cover.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  COVER_HEADLINE_MAX,
  COVER_HEADLINE_MIN,
  coverHeadlineSize,
  coverPlan,
} from "./cover";
import type { VideoPayload, VideoScene } from "../types/video";

function scene(overrides: Partial<VideoScene> = {}): VideoScene {
  return {
    id: "scene-1",
    text: "A headline",
    subtext: "A supporting line",
    narration: "",
    durationInFrames: 90,
    themeColor: "#7c3aed",
    keywords: ["one", "two"],
    imagePrompt: "",
    ...overrides,
  };
}

function payload(scenes: VideoScene[], title = "The Future of AI"): VideoPayload {
  return { title, fps: 30, aspectRatio: "9:16", scenes };
}

test("the cover uses the first scene that has a picture", () => {
  const plan = coverPlan(
    payload([
      scene({ id: "scene-1" }),
      scene({ id: "scene-2", imageSrc: "images/a.jpg", themeColor: "#22c55e", subtext: "Second" }),
      scene({ id: "scene-3", imageSrc: "images/b.jpg", themeColor: "#38bdf8" }),
    ]),
  );

  assert.equal(plan.imageSrc, "images/a.jpg");
  assert.equal(plan.themeColor, "#22c55e");
  assert.equal(plan.kicker, "Second");
});

test("with no picture anywhere the cover falls back to the first scene", () => {
  const plan = coverPlan(payload([scene({ themeColor: "#111111" }), scene({ id: "scene-2" })]));

  assert.equal(plan.imageSrc, undefined);
  assert.equal(plan.themeColor, "#111111");
});

test("the headline is the payload title", () => {
  assert.equal(coverPlan(payload([scene()], "Negative Visualization")).headline, "Negative Visualization");
});

test("the kicker falls back from subtext to text to keywords to nothing", () => {
  assert.equal(coverPlan(payload([scene({ subtext: "Sub" })])).kicker, "Sub");
  assert.equal(coverPlan(payload([scene({ subtext: "  ", text: "Text" })])).kicker, "Text");
  assert.equal(
    coverPlan(payload([scene({ subtext: "", text: "", keywords: ["stoic", "calm"] })])).kicker,
    "stoic • calm",
  );
  assert.equal(coverPlan(payload([scene({ subtext: "", text: "", keywords: [] })])).kicker, "");
});

test("a single-scene payload still produces a cover", () => {
  const plan = coverPlan(payload([scene({ imageSrc: "images/only.jpg" })]));

  assert.equal(plan.imageSrc, "images/only.jpg");
});

test("the headline shrinks as the title lengthens and never leaves its bounds", () => {
  const sizes = [0, 10, 20, 30, 40, 60, 120].map((length) => coverHeadlineSize("t".repeat(length)));

  sizes.forEach((size, index) => {
    assert.ok(size <= COVER_HEADLINE_MAX && size >= COVER_HEADLINE_MIN, `${size} out of bounds`);

    if (index > 0) {
      assert.ok(size <= sizes[index - 1], `${size} should not exceed ${sizes[index - 1]}`);
    }
  });

  assert.equal(sizes[0], COVER_HEADLINE_MAX);
  assert.equal(sizes[sizes.length - 1], COVER_HEADLINE_MIN);
});

test("surrounding whitespace does not shrink the headline", () => {
  assert.equal(coverHeadlineSize("   short   "), coverHeadlineSize("short"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/services/cover.test.ts`
Expected: FAIL — cannot find module `./cover`.

- [ ] **Step 3: Write the implementation**

Create `src/services/cover.ts`:

```ts
import type { VideoPayload } from "../types/video";

/**
 * What the cover still shows, as a pure function of the payload.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

/** Headline size for a short title: as large as the frame will take. */
export const COVER_HEADLINE_MAX = 132;

/** Headline size for a long one, chosen so three lines still fit the lower third. */
export const COVER_HEADLINE_MIN = 84;

export type CoverPlan = {
  /** Relative to public/, absent when no scene has a picture. */
  imageSrc?: string;
  themeColor: string;
  headline: string;
  kicker: string;
};

/** Steps the headline down as the title lengthens, so a long title wraps rather than overflows. */
export function coverHeadlineSize(headline: string): number {
  const length = headline.trim().length;

  if (length <= 14) {
    return COVER_HEADLINE_MAX;
  }

  if (length <= 24) {
    return 116;
  }

  if (length <= 36) {
    return 100;
  }

  return COVER_HEADLINE_MIN;
}

/**
 * Chooses the picture, the colour and the two lines.
 *
 * The opening scene is the one written to hook, so its picture is the cover
 * whenever it has one; a scene whose image generation failed is skipped rather
 * than leaving the cover blank.
 */
export function coverPlan(payload: VideoPayload): CoverPlan {
  const scene = payload.scenes.find((candidate) => candidate.imageSrc) ?? payload.scenes[0];

  if (!scene) {
    throw new Error("A cover needs at least one scene");
  }

  const kicker = scene.subtext.trim() || scene.text.trim() || scene.keywords.join(" • ");

  return {
    imageSrc: scene.imageSrc,
    themeColor: scene.themeColor,
    headline: payload.title,
    kicker,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/services/cover.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Register the test file and verify the suite**

In `package.json`, append ` src/services/cover.test.ts` to the end of the `test` script.

Run: `npm test` and `npm run build`
Expected: whole suite passes, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/cover.ts src/services/cover.test.ts package.json
git commit -m "Plan what the cover frame shows"
```

---

### Task 2: Draw the cover

**Files:**
- Create: `src/components/Cover.tsx`
- Modify: `src/Root.tsx` (add a second `Composition`)

**Interfaces:**
- Consumes: `coverPlan`, `coverHeadlineSize` (Task 1); `BASE_COLOR`, `rotateHue`, `toTransparentRgba`, `withAlpha` from `../services/palette`.
- Produces: `Cover: React.FC<{ video: VideoPayload }>`, and a composition with id `AI-Cover`.

- [ ] **Step 1: Write the component**

Create `src/components/Cover.tsx`:

```tsx
import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { coverHeadlineSize, coverPlan } from "../services/cover";
import { BASE_COLOR, rotateHue, toTransparentRgba, withAlpha } from "../services/palette";
import type { VideoPayload } from "../types/video";

/**
 * Heavier at the bottom than the video's scrim: the headline is larger, sits
 * lower, and has to hold at the size a feed shows it.
 */
const COVER_SCRIM =
  "linear-gradient(to bottom, rgba(2, 4, 9, 0.45) 0%, rgba(2, 4, 9, 0.15) 28%, " +
  "rgba(2, 4, 9, 0.72) 62%, rgba(2, 4, 9, 0.94) 100%)";

type CoverProps = {
  video: VideoPayload;
};

/**
 * The thumbnail. Deliberately static — no `useCurrentFrame`, no spring — so
 * the single frame it renders is the finished picture rather than the first
 * frame of an animation.
 */
export const Cover: React.FC<CoverProps> = ({ video }) => {
  const { imageSrc, themeColor, headline, kicker } = coverPlan(video);

  return (
    <AbsoluteFill style={{ backgroundColor: BASE_COLOR, overflow: "hidden" }}>
      {imageSrc ? (
        <Img
          src={staticFile(imageSrc)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        // No picture anywhere — a still of the drawn background, so a cover is
        // produced even for a --no-images render.
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              `radial-gradient(circle at 30% 24%, ${rotateHue(themeColor, 0)} 0%, ${toTransparentRgba(BASE_COLOR)} 56%), ` +
              `radial-gradient(circle at 74% 66%, ${rotateHue(themeColor, 32)} 0%, ${toTransparentRgba(BASE_COLOR)} 58%)`,
          }}
        />
      )}

      <div style={{ position: "absolute", inset: 0, background: COVER_SCRIM }} />

      <div style={{ position: "absolute", left: 84, right: 84, bottom: 240 }}>
        <div
          style={{
            fontSize: coverHeadlineSize(headline),
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1.02,
            color: "#f8fafc",
            textShadow: "0 10px 44px rgba(2, 4, 9, 0.9)",
          }}
        >
          {headline}
        </div>

        <div
          style={{
            width: 132,
            height: 10,
            margin: "36px 0 28px",
            borderRadius: 999,
            backgroundColor: themeColor,
            boxShadow: `0 0 36px ${withAlpha(themeColor, 0.65)}`,
          }}
        />

        {kicker ? (
          <div
            style={{
              fontSize: 40,
              fontWeight: 500,
              lineHeight: 1.25,
              color: "rgba(248, 250, 252, 0.82)",
              maxWidth: 820,
            }}
          >
            {kicker}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Register the composition**

In `src/Root.tsx`, add the import beside the `VideoRoot` one:

```ts
import { Cover } from "./components/Cover";
```

and add a second `Composition` inside the fragment, after the existing `AI-Video` one:

```tsx
      <Composition
        id="AI-Cover"
        component={Cover}
        durationInFrames={1}
        fps={defaultVideo.fps}
        width={getDimensions(defaultVideo.aspectRatio).width}
        height={getDimensions(defaultVideo.aspectRatio).height}
        defaultProps={{ video: defaultVideo }}
        calculateMetadata={({ props }) => {
          const dimensions = getDimensions(props.video.aspectRatio);

          return {
            // A still: one frame, and the fps only has to be legal.
            durationInFrames: 1,
            fps: props.video.fps,
            width: dimensions.width,
            height: dimensions.height,
          };
        }}
      />
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: no TypeScript errors.

Run: `npm test`
Expected: whole suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/Cover.tsx src/Root.tsx
git commit -m "Draw the cover frame"
```

---

### Task 3: Render the cover beside the video

**Files:**
- Create: `src/pipeline/cover.ts`
- Create: `src/pipeline/cover.test.ts`
- Modify: `src/pipeline/render.ts`
- Modify: `src/services/cli-args.ts`
- Modify: `src/services/cli-args.test.ts` (append)
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Consumes: nothing from Tasks 1-2 directly; it selects the `AI-Cover` composition by id.
- Produces:
  - `COVER_COMPOSITION_ID: string` (`"AI-Cover"`), `COVER_JPEG_QUALITY: number` (90)
  - `coverOutputLocation(videoLocation: string): string`
  - `renderCover(options: { serveUrl: string; payload: VideoPayload; videoLocation: string }): Promise<string | undefined>`
  - `parseArgs` gains `cover: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/pipeline/cover.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { coverOutputLocation } from "./cover";

test("the cover sits beside the video, as a jpg", () => {
  assert.equal(coverOutputLocation("/out/stoic-habits.mp4"), "/out/stoic-habits.jpg");
});

test("a dot in a directory name is not an extension", () => {
  assert.equal(coverOutputLocation("/a.dir/out/clip.mp4"), "/a.dir/out/clip.jpg");
  assert.equal(coverOutputLocation("C:\\a.dir\\out\\clip.mp4"), "C:\\a.dir\\out\\clip.jpg");
});

test("a path with no extension gains one rather than being overwritten", () => {
  assert.equal(coverOutputLocation("/out/clip"), "/out/clip.jpg");
});

test("the cover refuses to be written over the video", () => {
  assert.throws(() => coverOutputLocation("/out/clip.jpg"), /Refusing/);
});
```

Append to `src/services/cli-args.test.ts`:

```ts
test("--no-cover turns the cover off and is not read as a topic", () => {
  const args = parseArgs(["--topic", "Stoicism", "--no-cover"]);

  assert.equal(args.cover, false);
  assert.equal(args.topic, "Stoicism");
});

test("the cover is on by default", () => {
  assert.equal(parseArgs(["--topic", "Stoicism"]).cover, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/pipeline/cover.test.ts src/services/cli-args.test.ts`
Expected: FAIL — cannot find module `./cover`, and `args.cover` is `undefined`.

- [ ] **Step 3: Write the stage**

Create `src/pipeline/cover.ts`:

```ts
import path from "node:path";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { VideoPayload } from "../types/video";

/** The still composition registered in src/Root.tsx. */
export const COVER_COMPOSITION_ID = "AI-Cover";

/** A cover is uploaded, not archived: a PNG of a photographic still is several times the size for no visible gain. */
export const COVER_JPEG_QUALITY = 90;

/**
 * Where the cover for a video goes: the same path, as a .jpg.
 *
 * Throws rather than returning the path it was given, so the cover can never
 * be written over the video it was made from.
 */
export function coverOutputLocation(videoLocation: string): string {
  const cover = videoLocation.replace(/\.[^./\\]*$/, "") + ".jpg";

  if (cover === videoLocation) {
    throw new Error(`Refusing to write the cover over the video (${videoLocation}).`);
  }

  return cover;
}

/**
 * Renders the thumbnail from the bundle the video was just rendered from.
 *
 * Every failure is a fallback, never a throw: the video is already written by
 * the time this runs, and a missing cover must not fail a finished render.
 */
export async function renderCover({
  serveUrl,
  payload,
  videoLocation,
}: {
  serveUrl: string;
  payload: VideoPayload;
  videoLocation: string;
}): Promise<string | undefined> {
  try {
    const outputLocation = coverOutputLocation(videoLocation);

    const composition = await selectComposition({
      serveUrl,
      id: COVER_COMPOSITION_ID,
      inputProps: { video: payload },
    });

    await renderStill({
      serveUrl,
      composition,
      output: outputLocation,
      frame: 0,
      inputProps: { video: payload },
      imageFormat: "jpeg",
      jpegQuality: COVER_JPEG_QUALITY,
      overwrite: true,
    });

    console.log(`[cover] wrote ${path.basename(outputLocation)}`);

    return outputLocation;
  } catch (error) {
    console.warn(`[cover] falling back (${error instanceof Error ? error.message : String(error)})`);

    return undefined;
  }
}
```

- [ ] **Step 4: Add the flag**

In `src/services/cli-args.ts`, add `--no-cover` to the positional filter — the line currently reading:

```ts
      (arg, i) => !consumedIndices.has(i) && arg !== "--no-audio" && arg !== "--no-images" && arg !== "--no-music" && arg !== "--",
```

becomes:

```ts
      (arg, i) =>
        !consumedIndices.has(i) &&
        arg !== "--no-audio" &&
        arg !== "--no-images" &&
        arg !== "--no-music" &&
        arg !== "--no-cover" &&
        arg !== "--",
```

and add to the returned object, after `music`:

```ts
    cover: !argv.includes("--no-cover"),
```

- [ ] **Step 5: Wire it into the render**

In `src/pipeline/render.ts`:

Add the import beside the other stage imports:

```ts
import { renderCover } from "./cover";
```

Widen the options type:

```ts
  options: { audio?: boolean; images?: boolean; music?: boolean; cover?: boolean } = {},
```

After the `await renderMedia({ ... });` call, add:

```ts
  const coverLocation =
    options.cover === false
      ? undefined
      : await renderCover({ serveUrl, payload, videoLocation: outputLocation });
```

and return it:

```ts
  return {
    outputLocation,
    coverLocation,
    payload,
  };
```

In the direct-run block, read the flag and report the cover. Replace the destructure:

```ts
    const { topic, niche, sceneCount, payloadFile, audio, images, music, cover } = parseArgs(process.argv.slice(2));
```

pass it through in both `renderVideo` calls:

```ts
      const result = await renderVideo(brief, payload, { audio, images, music, cover });
```

```ts
    const result = await renderVideo(brief, undefined, { audio, images, music, cover });
```

and after each line reporting the finished render, add a line reporting the cover when there is one:

```ts
      if (result.coverLocation) {
        console.log(`Cover: ${result.coverLocation}`);
      }
```

(matching the indentation of the block it sits in).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx --test src/pipeline/cover.test.ts src/services/cli-args.test.ts`
Expected: PASS.

In `package.json`, append ` src/pipeline/cover.test.ts` to the end of the `test` script.

Run: `npm test` and `npm run build`
Expected: whole suite passes, no TypeScript errors.

- [ ] **Step 7: Verify against a real render**

Run: `npm run test:render`
Expected: the smoke render completes and writes both a `.mp4` and a `.jpg` in `out/`. Confirm by listing `out/`.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/cover.ts src/pipeline/cover.test.ts src/pipeline/render.ts src/services/cli-args.ts src/services/cli-args.test.ts package.json
git commit -m "Render a cover frame beside the video"
```

---

### Task 4: Documentation

**Files:**
- Modify: `README.md` (the `How it works`, `CLI` and `Failure behaviour` sections)
- Modify: `roadmap.md` (append Phase 15)

- [ ] **Step 1: Document the cover**

In `README.md`:

- Under `## How it works`, add a short paragraph: every render also writes `out/<slug>.jpg`, a purpose-built cover rather than a frame of the video — the first scene's generated picture under a heavier scrim, with the title and one supporting line, drawn by the `AI-Cover` composition and rendered with `renderStill` from the same bundle as the video.
- Under `## CLI`, add `--no-cover` to the flag list, beside `--no-music`.
- Under `## Failure behaviour`, add a line: the cover is rendered after the video is written and every error is caught, so it can never fail a render.

- [ ] **Step 2: Append the roadmap phase**

Add to the end of `roadmap.md`:

```markdown
---

### Phase 15: Cover Frame
- [x] Register a second composition, `AI-Cover`, one frame long at the video's size.
- [x] Choose the picture, colour and lines in a pure, tested `coverPlan`.
- [x] Draw a static cover: headline, accent rule and kicker over the first scene's picture.
- [x] Render it with `renderStill` from the same bundle, straight after the video.
- [x] Write it to `out/<slug>.jpg`, add `--no-cover`, and catch every failure.
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: whole suite passes.

- [ ] **Step 4: Commit**

```bash
git add README.md roadmap.md
git commit -m "Document the cover frame"
```

---

## Verification checklist

- `npm run build` — clean.
- `npm test` — all suites pass, including the two new files.
- `npm run test:render` — writes both an `.mp4` and a `.jpg` into `out/`.
- The cover opens as a readable thumbnail: the headline is legible when the image is scaled down to a feed tile, and no caption or keyword badge appears.
- `git status --short` — nothing generated left staged.
