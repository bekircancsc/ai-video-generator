# Cover Frame Design

**Date:** 2026-08-31
**Status:** Approved

## Problem

A finished render is an `.mp4` and nothing else. Every platform it is uploaded
to asks for a cover: a single still that has to work as a thumbnail in a feed,
at a fraction of its real size, often before a single frame has played. Today
the uploader either accepts whatever frame the platform picks or makes one by
hand.

## Decision: a purpose-built cover, not a frame of the video

A frame lifted from the video carries everything that belongs in motion and
nothing that belongs in a thumbnail: the keyword badge, a half-spoken caption
word, a title mid-spring. The cover is instead its **own Remotion
composition**, rendered as a still from the same bundle the video came from.

It reuses what the pipeline has already produced — the scene image, the theme
colour, the title — so it costs no extra model call and no extra wait. It reads
at thumbnail size because it is designed to: one headline, one supporting line,
nothing else.

## Architecture

Three units, split along the Node/browser boundary this codebase already keeps:

| Unit | Side | Responsibility |
|---|---|---|
| `src/services/cover.ts` | Browser-safe | Pure: choose the image, the colour and the two lines, and size the headline. |
| `src/components/Cover.tsx` | Browser | Draw the still. No `useCurrentFrame`, no spring. |
| `src/pipeline/cover.ts` | Node | Render the still beside the video, and never fail a render. |

`src/Root.tsx` registers a second composition, `AI-Cover`, one frame long, at
the same dimensions as the video. `src/pipeline/render.ts` renders it from the
**same `serveUrl`** it just used for the video, so the cover costs one still
render and no second bundle.

### What the cover shows

`coverPlan(payload)` decides everything, as a pure function of the payload:

- **The picture:** the first scene that has an `imageSrc`. Scenes are generated
  in order and the opening scene is the one written to hook, so its image is
  the right one whenever it exists. With no image anywhere — `--no-images`, or
  every generation failed — the plan carries none and the component draws the
  theme colour as a gradient instead, so a cover is always produced.
- **The colour:** the theme colour of the scene the picture came from, or of
  the first scene when there is no picture.
- **The headline:** `payload.title`.
- **The kicker:** the `subtext` of that same scene, falling back to its `text`,
  falling back to its keywords joined with ` • `, falling back to nothing.
- **The headline size:** `coverHeadlineSize(text)`, stepping down from 132px to
  84px as the title lengthens, so a long title wraps to at most three lines
  instead of overflowing the frame.

### How it is drawn

Static by construction: `Cover.tsx` reads no frame and runs no spring, so the
one frame it renders is the finished picture rather than the first frame of an
animation.

Layers, back to front: the near-black ground; the scene image full-bleed with
`objectFit: cover` and no zoom; a scrim weighted to the bottom two thirds,
heavier than the video's because the headline is larger and sits lower; the
headline, left-aligned in the lower third; a short accent rule in the theme
colour; the kicker beneath it. No keyword badge, no captions.

The frame is the video's own size (1080x1920 for 9:16) — the size every
short-form platform wants a cover in.

## Output

`out/<slug>.jpg`, the sibling of `out/<slug>.mp4`. JPEG at quality 90: a cover
is uploaded, not archived, and a PNG of a photographic still is several times
the size for no visible gain.

`renderVideo` returns `coverLocation` alongside `outputLocation`, undefined
when no cover was produced.

## Failure behaviour

The cover can never fail a render. It is produced **after** `renderMedia` has
written the video, and every error — a composition that will not select, a
still that will not write — is caught, logged as `[cover] falling back
(<reason>)`, and the run finishes reporting the video it already has.

## Interface changes

- `parseArgs` gains `cover: boolean`, set false by `--no-cover`.
- `renderVideo` options gain `cover?: boolean`.
- `renderVideo` returns `{ outputLocation, coverLocation?, payload }`.
- No change to `videoPayloadSchema`: the cover is derived, never stored.

## Testing

`node:test`, no network, no rendering:

- `coverPlan`: picks the first scene with an image; skips scenes without one;
  falls back to the first scene when none has one; each kicker fallback in
  turn; a payload of one scene.
- `coverHeadlineSize`: monotonically non-increasing as the title lengthens,
  and inside its bounds for an empty title and for a very long one.
- `coverOutputLocation`: swaps the video's extension for `.jpg`, and refuses to
  return the path it was given.

The drawing itself is checked by eye on a real render, as the video is.

## Out of scope

A cover in a second aspect ratio (16:9 for YouTube), a model-written cover
hook distinct from the title, text-on-image contrast measurement, and any
choice of cover other than "the first scene that has a picture".
