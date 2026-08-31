# Scene Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross-dissolve between consecutive scenes over 0.3 seconds, instead of cutting hard from one generated image to the next.

**Architecture:** Every scene after the first starts `TRANSITION_FRAMES` before its predecessor ends and fades its own opacity in across that overlap. The overlap arithmetic lives in two pure functions in `src/services/timing.ts`; `VideoRoot` places sequences with them and `Root.tsx` sizes the composition with them.

**Tech Stack:** TypeScript ES modules, Node 22 (`node:test`), Remotion 4, React 19, tsx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-31-scene-transitions-design.md`. Branch: `feature/scene-transitions`.
- **No new dependency.** `@remotion/transitions` is deliberately not used.
- **Never modify `src/services/gemini.ts`.**
- `src/services/timing.ts` is imported by browser-bundled components: it must not import `node:*` modules or `dotenv`.
- All prose, comments and log lines in **English**.
- Tests use `node:test` + `node:assert/strict` and make no network calls.
- Commit after every task with a plain, imperative subject line.

---

### Task 1: Overlap arithmetic

**Files:**
- Modify: `src/services/timing.ts` (append)
- Modify: `src/services/timing.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TRANSITION_FRAMES: number` (9)
  - `sceneStartFrames(durations: number[], overlap?: number): number[]`
  - `timelineFrames(durations: number[], overlap?: number): number`
  Both default `overlap` to `TRANSITION_FRAMES`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/timing.test.ts`:

```ts
test("scenes step forward by their duration minus the overlap", () => {
  assert.deepEqual(sceneStartFrames([90, 90, 90], 9), [0, 81, 162]);
});

test("the first scene always starts at frame zero", () => {
  assert.equal(sceneStartFrames([90, 90], 9)[0], 0);
  assert.equal(sceneStartFrames([90], 9)[0], 0);
});

test("the timeline is shorter than the sum by one overlap per join", () => {
  assert.equal(timelineFrames([90, 90, 90], 9), 270 - 2 * 9);
  assert.equal(timelineFrames([60, 120], 9), 180 - 9);
});

test("a single scene is its own length and starts at zero", () => {
  assert.deepEqual(sceneStartFrames([120], 9), [0]);
  assert.equal(timelineFrames([120], 9), 120);
});

test("an empty timeline is empty", () => {
  assert.deepEqual(sceneStartFrames([], 9), []);
  assert.equal(timelineFrames([], 9), 0);
});

test("an overlap of zero reproduces back-to-back scenes", () => {
  assert.deepEqual(sceneStartFrames([90, 60, 30], 0), [0, 90, 150]);
  assert.equal(timelineFrames([90, 60, 30], 0), 180);
});

test("a scene shorter than the overlap never starts before the one before it", () => {
  const starts = sceneStartFrames([90, 5, 90], 9);
  assert.ok(starts[1] > starts[0], `${starts[1]} should follow ${starts[0]}`);
  assert.ok(starts[2] > starts[1], `${starts[2]} should follow ${starts[1]}`);
  assert.ok(timelineFrames([90, 5, 90], 9) > 0);
});

test("the default overlap is the transition length", () => {
  assert.deepEqual(sceneStartFrames([90, 90]), sceneStartFrames([90, 90], TRANSITION_FRAMES));
  assert.equal(timelineFrames([90, 90]), timelineFrames([90, 90], TRANSITION_FRAMES));
});
```

Add `TRANSITION_FRAMES`, `sceneStartFrames` and `timelineFrames` to the existing
import from `./timing` at the top of that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/services/timing.test.ts`
Expected: FAIL — `sceneStartFrames is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/services/timing.ts`:

```ts
/**
 * Cross-dissolve length between consecutive scenes. 0.3s at 30fps: long
 * enough to read as a dissolve rather than a cut, short enough to fit inside
 * the tail silence every clip already carries, so speech is never clipped.
 */
export const TRANSITION_FRAMES = 9;

/**
 * How far one scene may reach back into the one before it.
 *
 * Clamped to both neighbours so a scene shorter than the overlap — a floor-length
 * scene of MIN_SCENE_FRAMES, say — can never start before its predecessor did.
 */
function effectiveOverlap(previousDuration: number, currentDuration: number, overlap: number): number {
  return Math.max(0, Math.min(overlap, previousDuration - 1, currentDuration));
}

/** Frame each scene starts on, once overlaps are applied. */
export function sceneStartFrames(durations: number[], overlap: number = TRANSITION_FRAMES): number[] {
  const starts: number[] = [];
  let cursor = 0;

  durations.forEach((duration, index) => {
    if (index === 0) {
      starts.push(0);
      cursor = duration;
      return;
    }

    const start = cursor - effectiveOverlap(durations[index - 1], duration, overlap);
    starts.push(start);
    cursor = start + duration;
  });

  return starts;
}

/** Total frames the timeline occupies, overlaps included. */
export function timelineFrames(durations: number[], overlap: number = TRANSITION_FRAMES): number {
  if (durations.length === 0) {
    return 0;
  }

  const starts = sceneStartFrames(durations, overlap);

  return starts[starts.length - 1] + durations[durations.length - 1];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/services/timing.test.ts`
Expected: PASS, all tests.

Run: `npm test` and `npm run build`
Expected: whole suite passes, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/timing.ts src/services/timing.test.ts
git commit -m "Compute an overlapped scene timeline"
```

---

### Task 2: Dissolve the scenes

**Files:**
- Modify: `src/VideoRoot.tsx` (the whole `scenes` mapping)
- Modify: `src/Root.tsx:44-46` (`getDurationInFrames`)

**Interfaces:**
- Consumes: `sceneStartFrames`, `timelineFrames`, `TRANSITION_FRAMES` (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Place the sequences on the overlapped timeline**

Replace the body of `src/VideoRoot.tsx` with:

```tsx
import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { Scene } from "./components/Scene";
import { sceneStartFrames, TRANSITION_FRAMES } from "./services/timing";
import type { VideoPayload, VideoScene } from "./types/video";

type VideoRootProps = {
  video: VideoPayload;
};

/**
 * One scene, faded in over the overlap it shares with the scene before it.
 * Sequences render in order, so this paints on top of the outgoing scene and
 * the two dissolve into each other rather than passing through black.
 */
const DissolvingScene: React.FC<{ scene: VideoScene; fadeInFrames: number }> = ({
  scene,
  fadeInFrames,
}) => {
  const frame = useCurrentFrame();
  const opacity =
    fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  return (
    <AbsoluteFill style={{ opacity }}>
      <Scene scene={scene} />
    </AbsoluteFill>
  );
};

export const VideoRoot: React.FC<VideoRootProps> = ({ video }) => {
  const starts = sceneStartFrames(video.scenes.map((scene) => scene.durationInFrames));

  return (
    <>
      {video.scenes.map((scene, index) => (
        <Sequence key={scene.id} from={starts[index]} durationInFrames={scene.durationInFrames}>
          {/* The opening scene has nothing to dissolve from, so it starts opaque. */}
          <DissolvingScene scene={scene} fadeInFrames={index === 0 ? 0 : TRANSITION_FRAMES} />
        </Sequence>
      ))}
    </>
  );
};
```

- [ ] **Step 2: Size the composition to the overlapped timeline**

In `src/Root.tsx`, add the import:

```ts
import { timelineFrames } from "./services/timing";
```

and replace `getDurationInFrames`:

```ts
const getDurationInFrames = (video: VideoPayload) => {
  return timelineFrames(video.scenes.map((scene) => scene.durationInFrames));
};
```

- [ ] **Step 3: Verify the types and the offline render**

Run: `npm run build`
Expected: no TypeScript errors.

Run: `npm test`
Expected: whole suite passes.

Run: `npm run test:render`
Expected: the smoke render completes. Its three 60-frame scenes now occupy
`180 - 2 * 9 = 162` frames, so the file is 5.4 seconds rather than 6.

- [ ] **Step 4: Verify the dissolve by eye**

Run: `node run.mjs --payload scripts/example-payload.json --no-audio`
Expected: renders with generated imagery.

Extract the frames around the first join and look at them — with three
90-frame scenes and a 9-frame overlap the join sits at frames 81 to 90:

```bash
npx remotion ffmpeg -y -i out/the-future-of-ai.mp4 -vf "select=eq(n\,85)" -frames:v 1 transition.png
```

Expected: `transition.png` shows both pictures mixed, neither fully gone nor
fully arrived, and no black flash. Delete the file afterwards
(`rm transition.png`) — it is a check, not an artifact.

- [ ] **Step 5: Commit**

```bash
git add src/VideoRoot.tsx src/Root.tsx
git commit -m "Cross-dissolve between scenes"
```

---

### Task 3: Documentation

**Files:**
- Modify: `README.md` (the `How it works` section, under the two rules)
- Modify: `roadmap.md` (append Phase 13)

- [ ] **Step 1: Document the timing rule**

In `README.md`, under `## How it works`, extend the **Speech drives timing**
paragraph (or add a short paragraph beside it) to say: consecutive scenes
overlap by `TRANSITION_FRAMES` (0.3s) and cross-dissolve, so the finished video
is `(scenes - 1) * 0.3s` shorter than the sum of its scene durations. The
overlap fits inside the 0.5s tail silence every clip already carries, so no
speech is lost. `src/services/timing.ts` is the one place that arithmetic
lives.

- [ ] **Step 2: Append the roadmap phase**

Add to the end of `roadmap.md`:

```markdown
---

### Phase 13: Scene Transitions
- [x] Overlap consecutive scenes by 0.3s and fade the incoming scene in across it.
- [x] Keep the arithmetic in two pure functions in `src/services/timing.ts`, with tests.
- [x] Size the composition from the overlapped timeline rather than the plain sum.
- [x] Add no dependency: no `@remotion/transitions`.
- [x] Leave audio and captions untouched — the overlap fits inside the existing tail silence.
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: whole suite passes.

- [ ] **Step 4: Commit**

```bash
git add README.md roadmap.md
git commit -m "Document scene transitions"
```

---

## Verification checklist

- `npm run build` — clean.
- `npm test` — all suites pass.
- `npm run test:render` — 162 frames, not 180.
- A frame inside the first join shows two pictures mixed, with no black flash.
- `git status --short` — nothing generated left staged.
