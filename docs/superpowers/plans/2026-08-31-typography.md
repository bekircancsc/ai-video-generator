# Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every rendered word use one embedded typeface, so the same payload produces the same pixels on any machine.

**Architecture:** Two Inter variable `woff2` subsets are committed under `public/fonts/`. A new browser-side module `src/fonts.ts` exports the family stack and a `loadFonts()` function built on `FontFace` + `delayRender`/`continueRender`. `src/Root.tsx` calls `loadFonts()` once at module scope; `VideoRoot.tsx` and `Cover.tsx` each set `fontFamily` on their root element, and the text components inherit it.

**Tech Stack:** Remotion 4, React 19, TypeScript, `node:test`. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-08-31-typography-design.md`

## Global Constraints

- **No new npm dependency.** Not `@remotion/fonts`, not `@remotion/google-fonts`. The load is hand-rolled on the `FontFace` browser API. This matches Phases 13 and 14, which both say "no dependency" in `roadmap.md`.
- **No network at render time.** The font files are committed and served from `public/`. A render must work with the machine offline.
- **`src/services/*.ts` must stay free of Node built-ins** — Remotion bundles them for the browser. `src/fonts.ts` is subject to the same rule.
- **`src/fonts.ts` must have no import-time side effects.** `FontFace` does not exist in Node; a self-loading module could not be imported by a `node:test` file. The `loadFonts()` call belongs in `src/Root.tsx`.
- **A `delayRender` handle must be continued on every path, including the `catch`.** An uncontinued handle hangs the render forever, which is worse than an ugly frame.
- **Every new test file must be added to the `test` script in `package.json`.** The script names each file explicitly; a test file not listed there never runs.
- **Commit messages:** imperative mood, sentence case, no `feat:`/`fix:` prefixes — match the existing log (`Draw the cover frame`, `Render a cover frame beside the video`).
- **Branch:** `feature/typography`, already created, stacked on `feature/cover-frame` (PR #9, still open).

---

### Task 1: Vendor the two Inter subsets

Commit the font binaries and record where they came from, so a later reader can re-fetch or update them without guessing.

**Files:**
- Create: `public/fonts/inter-latin.woff2` (binary, 48256 bytes)
- Create: `public/fonts/inter-latin-ext.woff2` (binary, 85068 bytes)
- Create: `public/fonts/README.md`
- Create: `public/fonts/OFL.txt`
- Verify: `.gitignore` (no change expected — read on)

**Interfaces:**
- Consumes: nothing.
- Produces: two files reachable from the bundle as `staticFile("fonts/inter-latin.woff2")` and `staticFile("fonts/inter-latin-ext.woff2")`.

- [ ] **Step 1: Confirm `public/fonts/` is not ignored**

`.gitignore` ignores `public/audio/`, `public/images/` and `public/music/` — the three generated-asset directories — but not `public/fonts/`, which is vendored source. Confirm this rather than assuming it:

```bash
git check-ignore -v public/fonts/inter-latin.woff2; echo "exit=$?"
```

Expected: no output and `exit=1` (nothing ignores it). If it prints a rule, stop and report — do not add a `!` negation without asking.

- [ ] **Step 2: Download both subsets**

The URLs are the ones Google Fonts serves for `Inter:wght@100..900`. They are version-pinned (`/v20/`), so they are stable.

```bash
mkdir -p public/fonts
curl -sS --fail -m 60 -o public/fonts/inter-latin.woff2 \
  "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2"
curl -sS --fail -m 60 -o public/fonts/inter-latin-ext.woff2 \
  "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2"
```

- [ ] **Step 3: Verify the downloads are real woff2 files**

A failed CDN fetch can still write a file — an HTML error page under a `.woff2` name would fail much later and confusingly. Check the size and the magic bytes (`wOF2`):

```bash
ls -l public/fonts/
head -c 4 public/fonts/inter-latin.woff2; echo
head -c 4 public/fonts/inter-latin-ext.woff2; echo
```

Expected: sizes `48256` and `85068`, and both `head` commands print `wOF2`.

If a size differs by a little, Google has republished the subset — that is fine, note the new size and continue. If a file is a few hundred bytes or does not start with `wOF2`, the download failed; do not commit it.

- [ ] **Step 4: Write the provenance note**

Create `public/fonts/README.md`:

```markdown
# Fonts

Inter, vendored so a render never depends on reaching a font CDN. Every other
asset directory under `public/` is generated and gitignored; this one is
checked in, because it is source.

| File | Bytes | Unicode range |
|---|---|---|
| `inter-latin.woff2` | 48256 | `U+0000-00FF`, `U+0131`, `U+0152-0153`, `U+02BB-02BC`, `U+02C6`, `U+02DA`, `U+02DC`, `U+0304`, `U+0308`, `U+0329`, `U+2000-206F`, `U+20AC`, `U+2122`, `U+2191`, `U+2193`, `U+2212`, `U+2215`, `U+FEFF`, `U+FFFD` |
| `inter-latin-ext.woff2` | 85068 | `U+0100-02BA`, `U+02BD-02C5`, `U+02C7-02CC`, `U+02CE-02D7`, `U+02DD-02FF`, `U+0304`, `U+0308`, `U+0329`, `U+1D00-1DBF`, `U+1E00-1E9F`, `U+1EF2-1EFF`, `U+2020`, `U+20A0-20AB`, `U+20AD-20C0`, `U+2113`, `U+2C60-2C7F`, `U+A720-A7FF` |

Both are variable across `font-weight: 100 900`, so the 500, 700 and 800 the
components ask for come out of one file each with no extra download.

The two are one family split by `unicode-range`, exactly as Google's own CSS
splits it. Both are needed for Turkish: dotless `ı` (U+0131) is in the latin
subset, while `ğ` (U+011F), `ş` (U+015F) and `İ` (U+0130) are in latin-ext.

## Source

Downloaded from the URLs in Google Fonts' CSS for `Inter:wght@100..900`:

    https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2
    https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2

To refresh them, re-read that CSS with a modern browser User-Agent (Google
serves `woff2` only to browsers that support it) and take the `latin` and
`latin-ext` blocks:

    curl -H "User-Agent: Mozilla/5.0 ... Chrome/120.0.0.0 ..." \
      "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap"

If the ranges above change, update `src/fonts.ts` to match — it repeats them,
because the `FontFace` API takes them as a descriptor rather than reading CSS.

## Licence

Inter is licensed under the SIL Open Font License 1.1, in `OFL.txt`.
```

- [ ] **Step 5: Fetch the licence text**

The OFL requires the licence to travel with the font. Do not paraphrase it:

```bash
curl -sS --fail -m 60 -o public/fonts/OFL.txt \
  "https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt"
head -3 public/fonts/OFL.txt
```

Expected: the first lines name the SIL Open Font License, Version 1.1. If the fetch fails, report it — do not write a licence file by hand.

- [ ] **Step 6: Commit**

```bash
git add public/fonts/
git commit -m "Vendor the Inter subsets"
```

---

### Task 2: The font module

A pure-ish browser module: one exported constant that is trivially testable, and one function that touches the DOM and is not.

**Files:**
- Create: `src/fonts.ts`
- Create: `src/fonts.test.ts`
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Consumes: the two files from Task 1, by their `public/`-relative paths.
- Produces:
  - `export const FONT_FAMILY: string` — used by Task 3 in `VideoRoot.tsx` and `Cover.tsx`.
  - `export function loadFonts(): void` — called by Task 3 in `src/Root.tsx`.

- [ ] **Step 1: Write the failing test**

Only the constant is tested. `loadFonts` is not: `FontFace` and `document.fonts` do not exist in Node, and a mock of them would assert that the mock was called. It is verified by a real render in Task 4 instead.

Create `src/fonts.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { FONT_FAMILY } from "./fonts";

test("the family stack asks for Inter first", () => {
  assert.ok(FONT_FAMILY.startsWith('"Inter"'), FONT_FAMILY);
});

test("the family stack ends in a generic family", () => {
  // The whole point of the stack is the failure path: if the woff2 never
  // loads, the text still has to be drawn in something. A stack of named
  // families only would leave that to the browser's default — the serif this
  // change exists to get rid of.
  const last = FONT_FAMILY.split(",").pop()?.trim();

  assert.equal(last, "sans-serif");
});

test("importing the module loads no font", () => {
  // Guards the constraint that makes this file importable at all: `FontFace`
  // does not exist in Node, so any import-time load would have thrown above,
  // and `loadFonts` must stay something the browser entry calls explicitly.
  assert.equal(typeof globalThis.FontFace, "undefined");
});
```

- [ ] **Step 2: Register the test file**

`package.json`'s `test` script lists every test file by name; an unlisted file silently never runs. Append ` src/fonts.test.ts` to the end of the space-separated list in the `"test"` script.

- [ ] **Step 3: Run the test and watch it fail**

```bash
npm test 2>&1 | tail -20
```

Expected: failure — `Cannot find module` for `./fonts`.

- [ ] **Step 4: Write the module**

Create `src/fonts.ts`:

```ts
import { continueRender, delayRender, staticFile } from "remotion";

/**
 * The typeface, embedded rather than borrowed.
 *
 * Without this the components inherit Chromium's default serif, which is Times
 * New Roman on Windows and DejaVu Serif on a Linux render box — so the same
 * payload produced a visibly different video depending on where it rendered.
 *
 * This module must stay free of Node built-ins, like `src/services/*`:
 * Remotion bundles it for the browser. It must also stay free of *import-time*
 * side effects, for the opposite reason — `FontFace` exists only in the
 * browser, so a module that loaded on import could not be imported by a test.
 */

/**
 * Two files, one family, split by `unicode-range` exactly as Google's own CSS
 * splits it. Turkish needs both: dotless `ı` is in the latin subset, while
 * `ğ ş İ` are in latin-ext.
 *
 * The ranges are repeated here because the `FontFace` API takes them as a
 * descriptor; they are not read from the woff2. `public/fonts/README.md` says
 * where they came from.
 */
const SUBSETS = [
  {
    file: "fonts/inter-latin.woff2",
    unicodeRange:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, " +
      "U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, " +
      "U+2212, U+2215, U+FEFF, U+FFFD",
  },
  {
    file: "fonts/inter-latin-ext.woff2",
    unicodeRange:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, " +
      "U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, " +
      "U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  },
] as const;

/**
 * The stack every composition sets on its root. The generic family at the end
 * is the failure path: if a face will not load, the frame is still drawn.
 */
export const FONT_FAMILY = '"Inter", system-ui, sans-serif';

/**
 * Registers both faces, holding the render until they are ready.
 *
 * Called once, at module scope in `src/Root.tsx`. Calling it twice would be
 * harmless — `document.fonts` is a set — but there is no reason to.
 *
 * Every path continues its handle, including the failure path. An abandoned
 * `delayRender` handle does not degrade the render, it hangs it forever, which
 * is a far worse outcome than a frame set in the fallback family.
 */
export function loadFonts(): void {
  for (const { file, unicodeRange } of SUBSETS) {
    const handle = delayRender(`Loading ${file}`);

    const face = new FontFace("Inter", `url(${staticFile(file)}) format("woff2")`, {
      weight: "100 900",
      style: "normal",
      display: "block",
      unicodeRange,
    });

    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
      })
      .catch((error: unknown) => {
        console.warn(`[fonts] falling back (${file}: ${String(error)})`);
      })
      .finally(() => {
        continueRender(handle);
      });
  }
}
```

Two details worth not changing:

- `display: "block"` — a `FontFace` descriptor, not CSS. With the default `auto`, Chromium may paint a frame in the fallback face while the woff2 is still decoding, which is exactly the nondeterminism being removed. `block` makes it wait.
- `.finally()` rather than a `continueRender` in both branches — one call site, so a later edit cannot continue one path and forget the other.

- [ ] **Step 5: Run the tests and the type check**

```bash
npm test 2>&1 | tail -20
npm run build
```

Expected: all tests pass (200 total: the 197 that existed, plus 3), and `tsc --noEmit` reports nothing.

If `tsc` rejects `display` or `unicodeRange` on the `FontFaceDescriptors` type, do not delete the descriptor — check the installed `typescript` and `lib.dom.d.ts` version and report it. Both are standard descriptors; a rejection means something is wrong with the type setup, not with the code.

- [ ] **Step 6: Commit**

```bash
git add src/fonts.ts src/fonts.test.ts package.json
git commit -m "Load Inter from public/fonts"
```

---

### Task 3: Apply the family

Two roots, two lines. Not three components — one place per composition, so the surfaces cannot drift apart.

**Files:**
- Modify: `src/Root.tsx` (call `loadFonts()` at module scope)
- Modify: `src/VideoRoot.tsx` (wrap the composition in a root that sets `fontFamily`)
- Modify: `src/components/Cover.tsx` (set `fontFamily` on the existing `AbsoluteFill`)

**Interfaces:**
- Consumes: `FONT_FAMILY` and `loadFonts` from `src/fonts.ts` (Task 2).
- Produces: no new exports. `AnimatedText`, `Captions` and the cover's own text inherit the family; none of them is edited.

- [ ] **Step 1: Call the loader from the browser entry**

In `src/Root.tsx`, add to the imports:

```tsx
import { loadFonts } from "./fonts";
```

and directly beneath the import block, before `const defaultVideo`:

```tsx
// Both compositions are registered here, so this is the one place that runs
// for either of them — and for the Studio preview.
loadFonts();
```

- [ ] **Step 2: Set the family on the video's root**

`VideoRoot` currently returns a bare `<>…</>` fragment, which has no element to carry a style. Wrap it in an `AbsoluteFill` — already imported in that file.

Replace the `return (` block of `VideoRoot` (the fragment, from `<>` to `</>`) with:

```tsx
  return (
    // The one place the video's typeface is set: `Scene`, `AnimatedText` and
    // `Captions` all inherit it rather than each naming a family of its own.
    <AbsoluteFill style={{ fontFamily: FONT_FAMILY }}>
      {video.musicSrc ? (
        <MusicBed src={video.musicSrc} spans={spans} totalFrames={totalFrames} />
      ) : null}
      {video.scenes.map((scene, index) => (
        <Sequence key={scene.id} from={starts[index]} durationInFrames={scene.durationInFrames}>
          {/* The opening scene has nothing to dissolve from, so it starts opaque. */}
          <DissolvingScene scene={scene} fadeInFrames={index === 0 ? 0 : overlap} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
```

and add to the imports in that file:

```tsx
import { FONT_FAMILY } from "./fonts";
```

`AbsoluteFill` is a plain absolutely-positioned `div` filling the frame; wrapping the sequences in one changes no layout, because they were already positioned against a full-frame parent.

- [ ] **Step 3: Set the family on the cover's root**

In `src/components/Cover.tsx`, add the import:

```tsx
import { FONT_FAMILY } from "../fonts";
```

and add `fontFamily` to the existing outer `AbsoluteFill`, which currently reads `style={{ backgroundColor: BASE_COLOR, overflow: "hidden" }}`:

```tsx
    <AbsoluteFill style={{ backgroundColor: BASE_COLOR, overflow: "hidden", fontFamily: FONT_FAMILY }}>
```

- [ ] **Step 4: Type check and test**

```bash
npm run build
npm test 2>&1 | tail -5
```

Expected: no type errors, all tests pass. No test asserts on this wiring — Task 4's render is what proves it.

- [ ] **Step 5: Commit**

```bash
git add src/Root.tsx src/VideoRoot.tsx src/components/Cover.tsx
git commit -m "Set the family on both composition roots"
```

---

### Task 4: Prove it renders, and re-measure the cover's size ladder

The only honest test of a typeface is a rendered frame. This task also settles the spec's one open question: whether `coverHeadlineSize`'s character steps still hold now that the glyphs are wider.

**Files:**
- Read: `out/*.mp4`, `out/*.jpg`, `out/*.png` (render output; `out/` is gitignored)
- Possibly modify: `src/services/cover.ts` (the thresholds in `coverHeadlineSize`)
- Possibly modify: `src/services/cover.test.ts` (the exact-boundary assertions at lines 92-97)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: no new exports. If the steps move, `COVER_HEADLINE_MAX` (132) and `COVER_HEADLINE_MIN` (84) keep their names and values; only the character thresholds inside `coverHeadlineSize` change.

- [ ] **Step 1: Run the offline smoke render**

```bash
npm run test:render
```

Expected: it prints `Smoke test complete: …` and writes both `out/offline-render-smoke-test.mp4` and `out/offline-render-smoke-test.jpg`.

Watch the log as it goes. If it **hangs** with no progress, that is the `delayRender` failure mode: a handle was taken and never continued. Do not wait it out — kill it and re-read the `.finally()` in `loadFonts`.

- [ ] **Step 2: Look at the cover**

Open `out/offline-render-smoke-test.jpg` with the Read tool and check three things:

1. The headline "Offline Render Smoke Test" is a **sans-serif** — no serifs on the terminals of the `O`, `R`, `T`. If it still has them, the font did not load and the fallback is drawing; check the console output from Step 1 for a `[fonts] falling back` warning.
2. The headline is not clipped by the frame and does not overflow its column.
3. It does not sit at an obviously wrong size — a single word alone on a line with half the column empty, or a headline pushed to four lines.

- [ ] **Step 3: Look at a video frame**

Extract a frame from the middle of the first scene, where the title and the captions are both on screen:

```bash
npx remotion still src/Root.tsx AI-Video out/frame-check.png --frame=45
```

Open `out/frame-check.png` with the Read tool. The scene title and the caption line should both be Inter — the same sans-serif as the cover. The captions are set at weight 800 with `letter-spacing: -0.01em` and uppercased; check the letters are not colliding at that tracking, which is the pairing the old serif was wrong for.

This renders the composition's `defaultProps`, so it has no audio and no captions of its own. If no caption line appears, that is expected — judge the title, and judge the captions from the smoke render's `.mp4` instead.

- [ ] **Step 4: Measure the ladder at its boundaries**

The steps at 14/15, 24/25 and 36/37 characters were calibrated against the default serif. Inter at weight 800 sets wider, so the question is whether a headline at the top of each bucket still fits the column it was sized for.

Render the cover at each boundary length. `renderStill` takes props on the command line, so no code change is needed:

```bash
npx remotion still src/Root.tsx AI-Cover out/ladder-14.png \
  --props='{"video":{"title":"Dopamine Detox","fps":30,"aspectRatio":"9:16","scenes":[{"id":"s1","text":"t","subtext":"A short supporting line.","narration":"n","durationInFrames":60,"themeColor":"#7c3aed","keywords":["a"]}]}}'
```

Repeat with these titles, changing both the title in the props and the output filename:

| File | Title | Chars | Expected size |
|---|---|---|---|
| `out/ladder-14.png` | `Dopamine Detox` | 14 | 132px |
| `out/ladder-24.png` | `Stoic Mornings That Work` | 24 | 116px |
| `out/ladder-36.png` | `Why Short Videos Win Every Single Ti` | 36 | 100px |
| `out/ladder-37.png` | `Why Short Videos Win Every Single Tim` | 37 | 84px |
| `out/ladder-german.png` | `Geschwindigkeitsbegrenzung` | 26 | 100px |

The last is the case PR #9 fixed: one unbreakable compound word that must wrap inside itself rather than being clipped.

These payloads carry no `imageSrc`, so the cover draws its theme-colour gradient instead of a picture. That is the right background for this measurement — it is the headline being judged, and a photograph would only make it harder to see the column edges.

- [ ] **Step 5: Judge the results**

Open all five with the Read tool and decide, per image:

- **Overflow** — the headline runs past the column's right edge, or the block runs off the bottom of the frame. The step is too large; the threshold must move down.
- **A large gap** — the headline takes far less room than the column offers, with most of a line empty. The step is too small.
- **Neither** — leave it alone.

Remember what the existing comment in `coverHeadlineSize` says: wrapping to one more line is the *intended* behaviour, not a failure. Only overflow past the frame, or an obviously wasted line, is a reason to move a number.

If every image is fine, **skip to Step 8** — the ladder survived the font change, and that is the good outcome, not a missed opportunity to change something.

- [ ] **Step 6: Move the thresholds, if the images demanded it**

Only if Step 5 found a real problem. Edit the thresholds in `coverHeadlineSize` in `src/services/cover.ts` — the `length <= 14`, `length <= 24` and `length <= 36` comparisons. Keep `COVER_HEADLINE_MAX` at 132 and `COVER_HEADLINE_MIN` at 84; the sizes are fine, it is the character counts that were calibrated against the wrong metrics.

Update the doc comment above the function: it currently cites `"Dopamine Detox"` and `"Stoic Mornings"` differing "by ninety pixels at 132px", a figure measured in the old serif. Replace it with what you measured in Inter, or drop the figure — do not leave a stale number that reads as fact.

Also update the comment on `COVER_HEADLINE_MIN`, which claims "at 84px the column holds roughly 23 characters". Re-count that from `out/ladder-37.png`.

Then update `src/services/cover.test.ts` lines 92-97 to the new boundaries. Those six assertions are the ones that pin the steps; the tests above them (monotonically non-increasing, within bounds, whitespace-trimmed) hold whatever the numbers are and must not be touched.

- [ ] **Step 7: Re-run the tests, if you changed anything**

```bash
npm test 2>&1 | tail -5
npm run build
```

Expected: all pass.

- [ ] **Step 8: Clean up the scratch renders and commit**

The ladder images were measurements, not artefacts. `out/` is gitignored, so this is tidiness rather than hygiene:

```bash
rm -f out/ladder-*.png out/frame-check.png
```

Commit only if Step 6 changed something:

```bash
git add src/services/cover.ts src/services/cover.test.ts
git commit -m "Recalibrate the headline ladder for Inter"
```

If nothing changed, say so plainly in the report and move on — "the ladder held" is a result.

---

### Task 5: Document it

**Files:**
- Modify: `roadmap.md` (append Phase 16)
- Modify: `README.md` (a note under `## How it works`)

**Interfaces:**
- Consumes: the outcome of Task 4, including whether the ladder moved.
- Produces: nothing consumed by code.

- [ ] **Step 1: Append the phase to `roadmap.md`**

Add at the end of the file, matching the existing style — past tense, one line per decision, every box checked:

```markdown
---

### Phase 16: Embedded Typography
- [x] Vendor two Inter variable subsets (latin, latin-ext) under `public/fonts/`.
- [x] Load them with `FontFace` and `delayRender` — no `@remotion/google-fonts`, no dependency, no network at render time.
- [x] Continue the render handle on the failure path too, so a font can never hang a render.
- [x] Set the family once per composition root; the text components inherit it.
- [x] Re-measure the cover's headline size ladder against the new metrics.
```

If Task 4 moved the thresholds, change that last line to say so: `- [x] Recalibrate the cover's headline size ladder, which was tuned against the old serif.`

- [ ] **Step 2: Add a paragraph to `README.md`**

Under `## How it works`, after the existing description of the rendering step, add:

```markdown
**Typography.** Every word on screen is set in Inter, vendored under
`public/fonts/` as two `unicode-range` subsets and loaded through `FontFace`.
Nothing is fetched at render time. Before this the components named no font at
all and inherited Chromium's default serif, so the same payload rendered
differently on Windows than on a Linux box.
```

- [ ] **Step 3: Verify the docs match the code**

Re-read both edits against what was actually built. In particular: if Task 4 left the ladder alone, neither file may claim it was recalibrated.

- [ ] **Step 4: Commit**

```bash
git add roadmap.md README.md
git commit -m "Document the embedded typography"
```

---

## Done when

- `npm test` passes, with `src/fonts.test.ts` in the `test` script and actually running.
- `npm run build` is clean.
- `npm run test:render` completes without hanging and writes both `.mp4` and `.jpg`.
- The rendered cover and a rendered video frame are both visibly sans-serif, checked by eye.
- The five ladder renders each fit their column, either because the thresholds held or because they were moved.
- `roadmap.md` and `README.md` describe what was built, including whether the ladder moved.
