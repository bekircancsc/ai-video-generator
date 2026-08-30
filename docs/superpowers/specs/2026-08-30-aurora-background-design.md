# Aurora Background Design

**Date:** 2026-08-30
**Status:** Approved

## Goal

Replace the flat radial gradient behind every scene with a slowly drifting
aurora of coloured light, so the frame stops reading as "empty gradient plus
text".

## Background

Phases 8 and 9 gave the pipeline a voice and captions. What is left is the
picture: every scene is still a single static radial gradient in the scene's
theme colour. It is the one part of the output that still looks like a
template.

The obvious answer is stock photography or generated imagery. Both were
considered and rejected for this phase. Stock introduces a second API key, a
licensing burden, and the risk of an off-topic photograph landing behind the
text. Generated imagery adds a provider, a cost per render, and several seconds
per scene. Neither is warranted when the stated goal is atmosphere rather than
literal illustration: the background should enrich the frame, not explain it.

Drawing the background in code costs nothing, cannot fail, cannot return
something inappropriate, and keeps the render fully offline.

## Constraint that shapes everything

**CSS animations do not work in Remotion.** Remotion renders frames one at a
time in a headless browser, seeking to each frame independently. A CSS
`@keyframes` animation has no meaning in that model: the wall-clock time a
`animation-delay` refers to never advances. Every moving value must be derived
from `useCurrentFrame()`.

This is not merely a porting detail. It changes the design for the better:
because motion is a function of the frame number and the scene's own length,
the drift can be normalised to scene duration. A 45-frame scene and a 294-frame
scene then feel the same, rather than the short one appearing frozen.

## Architecture

This phase adds no pipeline stage, no schema field, and no network call. It is
a rendering change only.

```
Scene.tsx
  ├── Background.tsx   (new — replaces the inline radial-gradient)
  ├── AnimatedText
  └── Captions
```

`Background` receives the scene's `themeColor` and `id` and draws itself. It
owns no state, fetches nothing, and reads only `useCurrentFrame()` and
`useVideoConfig()`.

## Components

| Path | Responsibility |
|---|---|
| `src/components/Background.tsx` | Create. Draws the aurora: blobs, grain, vignette. |
| `src/services/palette.ts` | Create. Pure colour maths: derive companion hues from one hex. |
| `src/services/palette.test.ts` | Create. Unit tests for the colour maths. |
| `src/services/seed.ts` | Create. Pure, deterministic seed from a scene id. |
| `src/services/seed.test.ts` | Create. Unit tests for the seed. |
| `src/components/Scene.tsx` | Modify. Mount `Background`, drop the inline gradient. |

`palette.ts` and `seed.ts` are browser-bundled, so they carry the same rule as
`timing.ts` and `caption-groups.ts`: no Node built-ins, no `dotenv`.

### The aurora

Three soft blobs, each a large blurred radial gradient, drift across the frame
on independent paths and scales. Position, scale and opacity are all
`interpolate` over the frame number.

Each blob's motion is normalised to the scene's duration: a blob completes the
same fraction of its path by the end of a scene regardless of how long that
scene runs. Motion is a slow drift, not a loop — nothing snaps back, because a
scene is only ever seen once.

Blobs sit on a near-black base (`#030712`), the colour the pipeline already
uses, so the darkest parts of the frame are unchanged and existing text
contrast is preserved.

### Colour

The payload gives one colour per scene. The second and third blobs derive from
it by rotating hue in HSL space by fixed offsets, keeping saturation and
lightness. This yields a coherent analogous palette from a single input, with
no schema change.

`palette.ts` exports:

```ts
hexToHsl(hex: string): { h: number; s: number; l: number }
hslToHex(h: number, s: number, l: number): string
rotateHue(hex: string, degrees: number): string
```

Three-digit hex (`#abc`) is accepted, because the scene schema's regex permits
it. An unparseable colour is not silently swallowed: it throws, because a
malformed `themeColor` means the payload is wrong and the render should say so.

### Per-scene variation

Blob starting positions come from a deterministic seed derived from the scene
`id`, so the three scenes of a video do not look like copies of each other. The
same scene renders identically every time — Remotion requires determinism, and
a background that differed between two renders of the same input would be a
bug, not a feature.

`seed.ts` exports `seedFromId(id: string): number`, a small string hash, and
`seededUnit(seed: number, index: number): number` returning a stable value in
`[0, 1)` for the nth draw from a seed. No `Math.random` anywhere.

### Grain and vignette

A film-grain layer and a vignette sit above the blobs and below the text. The
grain is a static SVG `feTurbulence` data URI, offset by a few pixels per frame
using a value derived from the frame number, which reads as shimmer without any
randomness. The vignette is a fixed radial gradient darkening the edges.

Both exist to serve legibility as much as looks: they are what keeps white text
readable over a bright blob, and what stops a plain CSS gradient looking cheap.

## Testing

Unit tests cover the pure maths only, following the pattern of the previous two
phases:

- `palette`: a known hex round-trips through HSL and back; `rotateHue` actually
  moves the hue and preserves saturation and lightness; three-digit hex is
  accepted; an invalid string throws.
- `seed`: the same id yields the same seed; different ids yield different seeds;
  `seededUnit` stays within `[0, 1)` and varies by index.

Appearance is not unit tested. It is verified by rendering and inspecting
extracted frames, as in Phases 8 and 9.

Render cost is measured, not assumed: large blurred layers per frame can slow
headless Chromium. The render time of a known payload is compared before and
after. If it regresses materially, the blur radius and blob count are the
levers to pull.

## Out of scope

Stock photography, generated imagery, video footage, and any per-scene art
direction driven by the script's `keywords`. Background music remains separate
future work.
