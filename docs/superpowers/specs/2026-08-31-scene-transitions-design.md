# Scene Transitions

## Problem

Scenes cut hard from one to the next. That was tolerable when every scene
shared the same aurora background, but now each scene carries its own generated
image, so the cut lands as a jolt: a whole new picture appears on one frame.

## Scope

- A 0.3 second cross-dissolve between consecutive scenes.
- No new dependency. The overlap and the fade are written here, the way the
  aurora background, the WAV decoder and the OpenAI adapter already are.
- Timeline arithmetic lives in one tested, pure module.

Out of scope: per-scene transition types, slides or wipes, transitions on the
audio track (the clips already carry lead-in and tail silence), configurable
transition length on the CLI.

## Architecture

Scenes keep their own `durationInFrames`. What changes is where each one
*starts*: every scene after the first begins `TRANSITION_FRAMES` before its
predecessor ends, and fades its own opacity from 0 to 1 across that overlap.
The outgoing scene keeps drawing underneath at full opacity until it ends, so
the two pictures dissolve rather than pass through black.

```
scene 1  ├────────────────┤
scene 2                ├────────────────┤
                       └── 9 frames of overlap
```

### Timing (`src/services/timing.ts`)

Two pure functions join the constants already there:

```ts
/** Cross-dissolve length. 0.3s at 30fps; short enough not to eat a beat of speech. */
export const TRANSITION_FRAMES = 9;

/** Frame each scene starts on, once overlaps are applied. */
export function sceneStartFrames(durations: number[], overlap?: number): number[];

/** Total frames the timeline occupies, overlaps included. */
export function timelineFrames(durations: number[], overlap?: number): number;
```

`overlap` defaults to `TRANSITION_FRAMES`. Both clamp the overlap to the
shorter of the two neighbouring scenes, so a scene can never start before the
one before it, and both return the plain sum when the overlap is zero or there
is a single scene.

This module is imported by both the components and `Root.tsx`, so it stays free
of Node built-ins, as it is today.

### Composition (`src/VideoRoot.tsx`)

`VideoRoot` stops accumulating `startFrame` itself and asks `sceneStartFrames`
instead. Each `<Sequence>` keeps its scene's own `durationInFrames`; the fade
is applied inside, by wrapping `<Scene>` in an `AbsoluteFill` whose opacity
interpolates from 0 to 1 over the first `TRANSITION_FRAMES` frames. The first
scene is not faded — a video should not open on a dissolve from nothing.

Later scenes are rendered after earlier ones, so the incoming scene naturally
paints on top; no z-index is needed.

### Duration (`src/Root.tsx`)

`getDurationInFrames` currently sums the scene durations. It calls
`timelineFrames` instead, so the composition is exactly as long as the
overlapped timeline. Nothing else in the pipeline changes: the voiceover stage
still sets each scene's length from its own measured speech.

## Audio and captions

Neither is touched. Each scene's `<Audio>` sits inside its own `Sequence`, so
it moves with the scene. The overlap consumes 0.3s of the outgoing scene's 0.5s
tail silence, which is why the tail exists; speech is never clipped. Captions
are timed against their own clip, so they move with it too.

## Testing

Added to `src/services/timing.test.ts`, no network and no rendering:

- Start frames for three equal scenes step by `duration - overlap`.
- The first scene always starts at 0.
- `timelineFrames` equals `sum - (n - 1) * overlap` for equal scenes.
- A single scene: start `[0]`, total equals its duration.
- An empty list: `[]` and 0.
- A scene shorter than the overlap does not start before its predecessor.
- An overlap of 0 reproduces today's back-to-back arithmetic.

Manual verification: `npm run test:render`, then watch the transition between
scenes one and two in the rendered file; and one payload render with imagery on
to confirm the dissolve reads well between two different pictures.

## Risks

- **A cut that is now a dissolve reads as slower.** 0.3s was chosen as the
  shortest dissolve the eye still registers; it is a single constant to retune.
- **Total duration shrinks** by `(n - 1) * 0.3s`. That is the intended effect of
  overlapping, and `timelineFrames` is the one place it is computed.
