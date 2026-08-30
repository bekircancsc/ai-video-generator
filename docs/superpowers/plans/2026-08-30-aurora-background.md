# Aurora Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat radial gradient behind every scene with a slowly drifting aurora of coloured light drawn entirely in code.

**Architecture:** A new `Background` component takes the scene's theme colour and id and draws three large soft colour clouds whose position and scale are interpolated from the current frame, over a near-black base, under a film-grain and vignette pass. Two pure helper modules supply the derived palette and the per-scene randomisation. No pipeline stage, no schema field, no network call.

**Tech Stack:** React, Remotion 4, TypeScript. Tests use the built-in `node:test` runner. This plan adds no npm dependencies.

## Global Constraints

- Add no npm dependencies.
- **CSS animations and transitions do not work in Remotion.** Remotion seeks to each frame independently in a headless browser, so `@keyframes`, `animation`, and `transition` have no meaning. Every moving value must be derived from `useCurrentFrame()`.
- **No `Math.random()` anywhere.** The same input must render identically every time; a background that differed between two renders of the same payload would be a bug. All variation comes from a seed derived from the scene id.
- Motion is normalised to the scene's own duration, so a 45-frame scene drifts as far as a 294-frame scene.
- Base colour, exact: `#030712`. This is the colour the pipeline already uses, so the darkest parts of the frame are unchanged.
- Hue offsets for the three blobs, exact: `0`, `32`, `-28` degrees.
- An unparseable `themeColor` throws. A malformed colour means the payload is wrong and the render must say so rather than silently drawing something else.
- **Nothing under `src/components/`, `src/Root.tsx`, or `src/VideoRoot.tsx` may import a module that touches `node:fs`, `node:crypto`, or `dotenv`.** Those files are bundled for the browser by Remotion, and a Node built-in reaching that bundle breaks it. Both new helper modules are imported by a component, so both must stay free of Node built-ins. Importing types from `src/types/video.ts` is safe because that file imports only `zod`, which is isomorphic.
- The `test` script in `package.json` lists test files explicitly. npm scripts run through `cmd.exe` on Windows, which does not expand globs. Append each new test file to that list.
- Scene duration, audio, and captions are untouched by this phase.

## File Structure

| Path | Responsibility |
|---|---|
| `src/services/palette.ts` | Create. Pure colour maths: hex to HSL and back, hue rotation. Browser-safe. |
| `src/services/palette.test.ts` | Create. Unit tests for the colour maths. |
| `src/services/seed.ts` | Create. Pure deterministic pseudo-randomness from a scene id. Browser-safe. |
| `src/services/seed.test.ts` | Create. Unit tests for the seed. |
| `src/components/Background.tsx` | Create. Draws the aurora, grain and vignette. |
| `src/components/Scene.tsx` | Modify. Mount `Background`; remove the inline gradient and the glow layer. |
| `package.json` | Modify. Append the two new test files to the `test` script. |
| `roadmap.md` | Modify. Record the phase. |

---

### Task 1: Colour maths

Pure functions with no React and no Node built-ins. The component needs a
palette derived from the single colour each scene carries.

**Files:**
- Create: `src/services/palette.ts`
- Test: `src/services/palette.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Hsl = { h: number; s: number; l: number }`
  - `hexToHsl(hex: string): Hsl`
  - `hslToHex(h: number, s: number, l: number): string`
  - `rotateHue(hex: string, degrees: number): string`

All three accept and return lowercase `#rrggbb`. `hexToHsl` also accepts
`#rgb`, because the scene schema's colour regex permits three-digit hex.

- [ ] **Step 1: Write the failing test**

Create `src/services/palette.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { hexToHsl, hslToHex, rotateHue } from "./palette";

test("round-trips a colour through HSL without drift", () => {
  for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#7c3aed", "#22c55e", "#f59e0b", "#000000", "#ffffff"]) {
    const { h, s, l } = hexToHsl(hex);
    assert.equal(hslToHex(h, s, l), hex, `${hex} did not survive the round trip`);
  }
});

test("expands three-digit hex", () => {
  assert.deepEqual(hexToHsl("#abc"), hexToHsl("#aabbcc"));
});

test("reports grey as having no saturation", () => {
  const { s } = hexToHsl("#808080");
  assert.equal(s, 0);
});

test("rotating hue moves the hue and leaves saturation and lightness alone", () => {
  const before = hexToHsl("#7c3aed");
  const after = hexToHsl(rotateHue("#7c3aed", 60));
  assert.equal(Math.round(after.h), Math.round((before.h + 60) % 360));
  assert.ok(Math.abs(after.s - before.s) < 0.01, "saturation drifted");
  assert.ok(Math.abs(after.l - before.l) < 0.01, "lightness drifted");
});

test("hue rotation wraps around the colour wheel", () => {
  assert.equal(rotateHue("#ff0000", 360), "#ff0000");
  assert.equal(Math.round(hexToHsl(rotateHue("#ff0000", -60)).h), 300);
});

test("rejects a colour it cannot parse", () => {
  assert.throws(() => hexToHsl("not a colour"), /Invalid hex colour/);
  assert.throws(() => hexToHsl("#12345"), /Invalid hex colour/);
});
```

- [ ] **Step 2: Extend the test script**

In `package.json`, append `src/services/palette.test.ts` to the end of the
`test` script's file list, leaving the existing entries in place.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module './palette'`.

- [ ] **Step 4: Write the implementation**

Create `src/services/palette.ts`:

```ts
/**
 * Colour maths for deriving a palette from a scene's single theme colour.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

export type Hsl = { h: number; s: number; l: number };

/** Expands #rgb to #rrggbb and rejects anything that is not a hex colour. */
function normaliseHex(hex: string): string {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());

  if (!match) {
    throw new Error(`Invalid hex colour "${hex}". Expected #rgb or #rrggbb.`);
  }

  const body = match[1];

  return body.length === 3
    ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`.toLowerCase()
    : `#${body.toLowerCase()}`;
}

export function hexToHsl(hex: string): Hsl {
  const full = normaliseHex(hex);
  const r = parseInt(full.slice(1, 3), 16) / 255;
  const g = parseInt(full.slice(3, 5), 16) / 255;
  const b = parseInt(full.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;

  if (max === r) {
    h = 60 * (((g - b) / delta) % 6);
  } else if (max === g) {
    h = 60 * ((b - r) / delta + 2);
  } else {
    h = 60 * ((r - g) / delta + 4);
  }

  return { h: (h + 360) % 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];

  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Shifts a colour around the wheel, keeping its saturation and lightness. */
export function rotateHue(hex: string, degrees: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + degrees, s, l);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 48 tests.

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/services/palette.ts src/services/palette.test.ts package.json
git commit -m "Add colour maths for deriving a scene palette"
```

---

### Task 2: Deterministic per-scene variation

The three scenes of a video must not look like copies of each other, but the
same scene must render identically every time. That rules out `Math.random`
and calls for a hash of the scene id.

**Files:**
- Create: `src/services/seed.ts`
- Test: `src/services/seed.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `seedFromId(id: string): number` — an unsigned 32-bit hash.
  - `seededUnit(seed: number, index: number): number` — a stable value in `[0, 1)` for the nth draw from a seed.

- [ ] **Step 1: Write the failing test**

Create `src/services/seed.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { seedFromId, seededUnit } from "./seed";

test("the same id always yields the same seed", () => {
  assert.equal(seedFromId("scene-1"), seedFromId("scene-1"));
});

test("different ids yield different seeds", () => {
  const seeds = new Set(["scene-1", "scene-2", "scene-3", "a", "b"].map(seedFromId));
  assert.equal(seeds.size, 5);
});

test("draws stay inside the unit interval", () => {
  for (const id of ["scene-1", "scene-2", "scene-3"]) {
    for (let index = 0; index < 12; index += 1) {
      const value = seededUnit(seedFromId(id), index);
      assert.ok(value >= 0 && value < 1, `${id}[${index}] was ${value}`);
    }
  }
});

test("a draw is stable for the same seed and index", () => {
  assert.equal(seededUnit(seedFromId("scene-1"), 3), seededUnit(seedFromId("scene-1"), 3));
});

test("consecutive indices give unrelated draws", () => {
  const seed = seedFromId("scene-1");
  const draws = [0, 1, 2, 3, 4, 5].map((index) => seededUnit(seed, index));
  assert.equal(new Set(draws).size, draws.length);
});

/**
 * Scene ids differ only in their last character, so a weak mix produces nearly
 * identical first draws and every scene ends up looking the same. This guards
 * against that specific failure.
 */
test("ids that differ by one character still spread apart", () => {
  const first = ["scene-1", "scene-2", "scene-3"].map((id) => seededUnit(seedFromId(id), 0));

  for (let a = 0; a < first.length; a += 1) {
    for (let b = a + 1; b < first.length; b += 1) {
      assert.ok(
        Math.abs(first[a] - first[b]) > 0.05,
        `draws ${first[a]} and ${first[b]} are too close together`,
      );
    }
  }
});
```

- [ ] **Step 2: Extend the test script**

In `package.json`, append `src/services/seed.test.ts` to the end of the `test`
script's file list, leaving the existing entries in place.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module './seed'`.

- [ ] **Step 4: Write the implementation**

Create `src/services/seed.ts`:

```ts
/**
 * Deterministic stand-in for randomness.
 *
 * Remotion renders each frame independently and must produce the same picture
 * every time, so `Math.random` is not available to us. Variation instead comes
 * from hashing the scene id.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

/** FNV-1a over the id, returned as an unsigned 32-bit integer. */
export function seedFromId(id: string): number {
  let hash = 2166136261;

  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/**
 * The nth draw from a seed, in [0, 1).
 *
 * The index is mixed into the seed before the avalanche rather than added to
 * it afterwards. Scene ids differ only in their final character, and a weaker
 * mix leaves the first draw of every scene clustered together, which would
 * make all three scenes of a video look alike.
 */
export function seededUnit(seed: number, index: number): number {
  let x = Math.imul(seed ^ ((index + 1) * 0x9e3779b1), 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;

  return (x >>> 0) / 4294967296;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 54 tests.

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/services/seed.ts src/services/seed.test.ts package.json
git commit -m "Add deterministic per-scene variation"
```

---

### Task 3: The aurora background

**Files:**
- Create: `src/components/Background.tsx`
- Modify: `src/components/Scene.tsx`
- Modify: `roadmap.md`

**Interfaces:**
- Consumes: `rotateHue` (Task 1), `seedFromId` and `seededUnit` (Task 2).
- Produces: `Background`, a component taking `{ themeColor: string; sceneId: string; durationInFrames: number }`.

This task has no new unit tests. The maths it relies on is already covered;
what remains is appearance, which is verified by rendering and looking at the
frames.

- [ ] **Step 1: Write the component**

Create `src/components/Background.tsx`:

```tsx
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { rotateHue } from "../services/palette";
import { seedFromId, seededUnit } from "../services/seed";

/** The near-black the pipeline already used, kept so text contrast is unchanged. */
const BASE_COLOR = "#030712";

/** Hue offsets for the three clouds, giving an analogous palette from one colour. */
const HUE_OFFSETS = [0, 32, -28];

/**
 * Film grain as an inline SVG turbulence pattern. A texture rather than a
 * filter: filters are recomputed per frame by the browser and this is not.
 */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter>" +
  "<rect width='140' height='140' filter='url(%23n)' opacity='0.55'/></svg>\")";

type BackgroundProps = {
  themeColor: string;
  sceneId: string;
  durationInFrames: number;
};

export const Background: React.FC<BackgroundProps> = ({ themeColor, sceneId, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const seed = seedFromId(sceneId);

  // Normalised to the scene's own length, so a short scene drifts as far as a
  // long one instead of appearing frozen.
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // A few pixels of shift per frame reads as shimmer without any randomness.
  const grainShift = (frame % 5) * 9;

  return (
    <AbsoluteFill style={{ backgroundColor: BASE_COLOR, overflow: "hidden" }}>
      {HUE_OFFSETS.map((offset, index) => {
        const startX = 20 + seededUnit(seed, index * 4) * 60;
        const startY = 15 + seededUnit(seed, index * 4 + 1) * 70;
        const driftX = (seededUnit(seed, index * 4 + 2) - 0.5) * 34;
        const driftY = (seededUnit(seed, index * 4 + 3) - 0.5) * 34;
        const size = Math.max(width, height) * (0.85 + index * 0.14);

        return (
          <div
            key={offset}
            style={{
              position: "absolute",
              width: size,
              height: size,
              left: `${startX + driftX * progress}%`,
              top: `${startY + driftY * progress}%`,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              borderRadius: "50%",
              // The gradient's own falloff is what makes the cloud soft. A CSS
              // blur would look the same and cost far more per frame.
              background: `radial-gradient(circle, ${rotateHue(themeColor, offset)} 0%, rgba(3, 7, 18, 0) 70%)`,
              opacity: 0.6 - index * 0.1,
              transform: `scale(${1 + progress * 0.16})`,
            }}
          />
        );
      })}

      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: GRAIN,
          backgroundPosition: `${grainShift}px ${grainShift}px`,
          opacity: 0.09,
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
};
```

- [ ] **Step 2: Mount it in the scene**

In `src/components/Scene.tsx`, add this import beneath the existing `Captions`
import:

```tsx
import { Background } from "./Background";
```

Replace the opening `<AbsoluteFill ...>` tag, which currently carries the
`radial-gradient` background, with:

```tsx
    <AbsoluteFill style={{ backgroundColor: "#030712", overflow: "hidden" }}>
      <Background
        themeColor={scene.themeColor}
        sceneId={scene.id}
        durationInFrames={scene.durationInFrames}
      />
```

Then delete the glow `<div>` that follows the `<Audio>` block — the whole
element whose style sets `background: radial-gradient(circle at center, ${scene.themeColor}${...bgGlow...}` — because `Background` now owns the frame's colour.

Finally delete the now-unused `bgGlow` line from the top of the component:

```tsx
  const bgGlow = interpolate(frame, [0, scene.durationInFrames], [0.2, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
```

`frame` and `interpolate` become unused in this file once `bgGlow` is gone.
Remove `const frame = useCurrentFrame();`, and drop `interpolate` and
`useCurrentFrame` from the `remotion` import, leaving the other named imports
(`AbsoluteFill`, `Audio`, `Sequence`, `staticFile`, `useVideoConfig`) intact.
`useVideoConfig` is still needed: `leadInFrames` uses `fps`.

Check this by reading the file. `noUnusedLocals` is not enabled in
`tsconfig.json`, so `npm run build` will **not** flag a leftover import — the
typecheck passing is not evidence that you removed them.

- [ ] **Step 3: Typecheck and test**

Run: `npm run build`
Expected: no output, exit 0.

Run: `npm test`
Expected: PASS, 54 tests.

- [ ] **Step 4: Time the render before judging it**

Run and note the wall-clock time:

```bash
time npm run test:render
```

Expected: `Smoke test complete:`, no `[voiceover]` or `[captions]` lines. Record
the elapsed time. Three large gradients per frame should not slow the render
materially; if it has more than doubled, say so in your report rather than
pressing on — the blob count and the `size` multiplier are the levers.

- [ ] **Step 5: Look at the result**

Extract three frames, one from each scene, and inspect them:

```bash
npx remotion ffmpeg -y -ss 00:00:01.5 -i out/smoke-test.mp4 -frames:v 1 -vf scale=405:720 frame-a.png
npx remotion ffmpeg -y -ss 00:00:04.5 -i out/smoke-test.mp4 -frames:v 1 -vf scale=405:720 frame-b.png
npx remotion ffmpeg -y -ss 00:00:07.5 -i out/smoke-test.mp4 -frames:v 1 -vf scale=405:720 frame-c.png
```

Read each PNG and confirm: the background shows soft coloured clouds rather
than a single centred circle, the three scenes do not look like copies of each
other, and the white title is still comfortably readable. Report what you see.
Delete the three PNGs afterwards; they are scratch, not artefacts.

- [ ] **Step 6: Update the roadmap**

Append to `roadmap.md`:

```markdown

---

### Phase 10: Aurora Background
- [x] Draw the scene background in code: three drifting colour clouds over a near-black base.
- [x] Derive the palette from the scene's own `themeColor` by rotating hue.
- [x] Vary the clouds per scene from a hash of the scene id, with no `Math.random`.
- [x] Normalise the drift to scene duration so short and long scenes feel alike.
- [x] Keep the grain and vignette that hold text legible.
```

- [ ] **Step 7: Commit**

```bash
git add src/components/Background.tsx src/components/Scene.tsx roadmap.md
git commit -m "Draw the scene background as a drifting aurora"
```

---

## Verification Checklist

- [ ] `npm test` passes, 54 tests.
- [ ] `npm run build` is clean.
- [ ] `npm run test:render` still renders offline with no stage logs, and no slower than roughly before.
- [ ] Extracted frames show soft drifting colour, not a static centred circle.
- [ ] The three scenes look distinct from one another.
- [ ] Title and captions remain readable over the brightest part of the background.
- [ ] No `Math.random`, no CSS `animation` or `transition`, anywhere in the new code.
