# Typography Design

**Date:** 2026-08-31
**Status:** Approved

**Stacks on:** PR #9 (`feature/cover-frame`). The cover is one of the three
surfaces this changes, and it exists only on that branch.

## Problem

There is no `fontFamily` anywhere in `src/`. Not one. The headline, the
subtext, the captions and the cover all inherit whatever Chromium picks for an
unstyled block — its default serif.

Three things follow from that, in rising order of cost:

1. **It is the wrong typeface.** A serif drawn for body text at 12px is being
   set at 64px in weight 800 with `letter-spacing: -0.04em`. The negative
   tracking in `AnimatedText` and `Captions` was written for a grotesk; a serif
   under it collides.
2. **It is not the same typeface twice.** The default serif is Times New Roman
   on Windows, Liberation Serif or DejaVu Serif on a Linux render box. The same
   payload produces visibly different videos on different machines.
3. **It silently breaks the cover's layout maths.** `coverHeadlineSize` steps
   the headline down at 14/15, 24/25 and 36/37 characters. Character count is a
   proxy for width, and the proxy was calibrated against a font that changes
   underfoot.

## Decision: one embedded variable font, loaded from `public/`

Inter, self-hosted, committed to the repository. Not `@remotion/google-fonts`,
which would make every render — including the offline smoke render — depend on
reaching `fonts.gstatic.com`. Not a `system-ui` stack, which swaps one
machine-dependent font for another and solves nothing.

The pipeline is keyless and offline by default everywhere else (`--no-audio`,
`--no-images`, a synthesized music bed, a keyless image provider). Its
typography should be too.

### Why two files

Google's own CSS splits Inter into `unicode-range` subsets, and the split is
worth keeping:

| File | Range | Size | Carries |
|---|---|---|---|
| `public/fonts/inter-latin.woff2` | `U+0000-00FF`, `U+0131`, ... | 48KB | English, German `äöüß`, Turkish `ı` |
| `public/fonts/inter-latin-ext.woff2` | `U+0100-02BA`, `U+1E00-1E9F`, ... | 85KB | Turkish `ğ ş İ`, the rest of Latin Extended |

Measured, not estimated — 133KB for the pair. Note that dotless `ı` (U+0131)
sits in the *latin* subset while `ğ ş İ` sit in *latin-ext*: Turkish needs both
files, which is the case that makes the split worth getting right.

Two `@font-face` rules, **one** `font-family`, split by `unicode-range` —
mechanically identical to what Google serves. The alternative is the unsubset
variable font: one file, ~300KB, for glyphs no payload will ever set.

Both files are variable across `font-weight: 100 900`, so the 500, 700 and 800
already in use cost no extra download.

## Architecture

One new browser-side module, `src/fonts.ts`, and two lines of application.

`src/fonts.ts` exports two things and runs nothing on import:

- `FONT_FAMILY` — the family stack, `"Inter", system-ui, sans-serif`.
- `loadFonts()` — registers both faces.

Loading is hand-rolled on `FontFace` and `delayRender`/`continueRender`, with
no added dependency — the same choice Phases 13 and 14 made.

`loadFonts()` is **called once**, at module scope in `src/Root.tsx`, the
browser-only entry both compositions pass through. It is deliberately not a
module-scope side effect of `fonts.ts` itself: `FontFace` does not exist in
Node, so a self-loading module could not be imported by a `node:test` file at
all. Keeping the call in the browser entry is what leaves `FONT_FAMILY`
testable.

`fontFamily` is set **once per composition**, on the root of `VideoRoot.tsx`
and the root of `Cover.tsx`. `AnimatedText`, `Captions` and the cover's
headline and kicker inherit it. Nothing is set per component: three call sites
is three places for them to drift apart.

## Failure behaviour

The font can never hang a render. `continueRender` is called on the success
path **and** in the `catch`; a `delayRender` handle that is never continued
blocks the render forever, which is a worse failure than an ugly one.

On failure the CSS fallback stack takes over: the render finishes, looking as
machine-dependent as it does today. This is the same shape as the cover's
guarantee — degrade to the previous behaviour, never to no output.

## Consequence: the cover's size ladder

Inter at weight 800 sets wider than Times New Roman at the same pixel size, so
the 14/15, 24/25 and 36/37 character steps in `coverHeadlineSize` are now
calibrated against the wrong metrics.

This is measured, not guessed. Real covers are rendered — including the 31
character German compound that PR #9 used to prove word-internal wrapping —
and the result looked at. The steps move only if a headline overflows its
column or leaves an obvious gap; if the ladder still holds, it is left alone.
Any change to the numbers changes `src/services/cover.test.ts` with them.

## Testing

The load path is not unit-testable in a way that would mean anything:
`FontFace` and `document.fonts` are browser APIs, and a mock of them would
assert that the mock was called. It is not faked.

What is tested is what is pure:

- `FONT_FAMILY` names Inter first and keeps a generic fallback last, so a
  failed load still lands on something.
- `coverHeadlineSize`, if its steps move — the existing properties
  (monotonically non-increasing, bounded) hold either way.

The typeface itself is verified the way the rest of the drawing is: a real
render, looked at. Acceptance is a rendered `.mp4` frame and `.jpg` set in
Inter, with the German compound headline intact.

## Out of scope

A second family for the cover, per-scene font choice, a `--no-font` flag (the
font is local, cannot fail from the network, and the fallback stack already
covers a corrupt file), and any change to the sizes, weights or tracking
already in the components beyond what the ladder measurement forces.
