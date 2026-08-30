# Voiceover Audio for the Video Pipeline

Date: 2026-08-30
Status: Approved

## Problem

The pipeline renders silent text cards. A Short with no narration does not hold
attention, so voiceover is the first missing layer. Adding it forces a second
change: scene length is currently a number the language model invents (100
frames for every scene), which has no relationship to how long the narration
actually takes to speak.

## Decisions

| Question | Decision |
|---|---|
| Scene length vs. speech length | Audio wins. Measured speech length rewrites `durationInFrames`. |
| Narration language | English. |
| TTS provider | Groq `canopylabs/orpheus-v1-english`, reusing the existing `LLM_API_KEY`. |
| Narration source | A dedicated `narration` field per scene, separate from on-screen text. |

## Verified before writing this spec

- Groq exposes `POST /openai/v1/audio/speech` and the existing key reaches it.
- Model terms have been accepted on the account.
- Valid voices: `autumn`, `diana`, `hannah`, `austin`, `daniel`, `troy`.
- Output is RIFF/WAVE, 24 kHz, mono, 16-bit. A 6.5 second line took 914 ms.

## Flow

```
topic -> LLM (script including narration)
      -> TTS (one WAV per scene, content-hashed cache)
      -> duration measurement (WAV header)
      -> durationInFrames rewritten
      -> Remotion bundle + render -> MP4
```

Audio is produced before bundling, so by the time Remotion runs every clip is a
static asset under `public/audio/`. Remotion stays declarative and needs no
knowledge of the synthesis step.

## Components

### `src/services/tts.ts`
Wraps Groq's speech endpoint and returns a WAV `Buffer`. Shaped like the
existing LLM adapter: reads `TTS_PROVIDER`, `TTS_VOICE`, `TTS_MODEL` from the
environment so a second provider can be added later without touching callers.

Depends on: `fetch`, environment.

### `src/services/audio-duration.ts`
Pure function. Walks RIFF chunks to find `fmt ` and `data`, then returns
duration in seconds from byte length, sample rate, channel count and bit depth.
Walking chunks rather than assuming a 44-byte header keeps it correct when the
encoder emits extra metadata chunks.

Depends on: nothing. Unit-testable with a synthetic header, no network.

### `src/pipeline/voiceover.ts`
Orchestration. For each scene: skip if narration is empty, otherwise resolve the
cache path, synthesize on a miss, measure, and compute the new frame count.
Returns a new payload plus the list of written assets. Does not mutate its input.

Depends on: the two services above.

### `src/components/Scene.tsx`
Renders `<Audio src={staticFile(scene.audioSrc)} />` when `audioSrc` is present.

## Duration rule

```
durationInFrames = ceil((leadIn + speechSeconds + tail) * fps)
leadIn = 0.25s, tail = 0.5s, floor = 45 frames
```

Without padding, speech starts on frame 0 and the scene cuts the moment the last
word ends. The floor stops a one-word narration from producing a scene too short
to read.

## Caching

Filename is the first 16 hex characters of `sha256(narration + voice + model)`.
Re-rendering an unchanged script performs no synthesis at all, which keeps
iteration fast and stays off the quota. `public/audio/` is gitignored.

## Error handling

- `model_terms_required` reports the console URL to accept terms.
- A TTS failure aborts the render. The pipeline never silently ships a silent
  video; producing one is an explicit choice via `--no-audio`.
- An empty `narration` leaves that scene silent and keeps the model's own
  `durationInFrames`.

## Schema changes

`VideoScene` gains `narration: string` and `audioSrc?: string`. The prompt gains
an instruction to write on-screen text for the eye and narration for the ear.
`scripts/example-payload.json` and `src/pipeline/test-render.ts` are updated to
carry narration.

## Testing

- Unit: `audio-duration` against synthetic WAV headers, including a file with an
  extra chunk before `data`.
- Unit: the frame calculation, including the floor and padding.
- Offline: the existing smoke test runs with `--no-audio` and stays network-free.
- Live: one end-to-end run against Groq confirming the rendered MP4 carries
  audio and that scene lengths match the narration.

## Out of scope

Caption synchronisation, background music, and visual b-roll. Each is a separate
feature and none should be layered on before voiceover is stable.
