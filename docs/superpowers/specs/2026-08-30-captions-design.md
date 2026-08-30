# Spoken-Word Captions Design

**Date:** 2026-08-30
**Status:** Approved

## Goal

Burn word-synchronised captions into every rendered video, so the pipeline's
output stays legible with the sound off — which is how most short-form video is
actually watched.

## Background

Phase 8 gave each scene a narration clip and retimed the scene to its measured
length. The words are now spoken but never written: the frame carries only a
scene title and a subtitle line the model wrote for the eye. This design adds
the spoken words themselves, timed to the audio.

The narration text is already known, so transcription is not being used to
discover *what* was said. It is used to discover *when* each word was said.

## Architecture

Captions are a pipeline stage that runs immediately after voiceover and before
Remotion bundling, mirroring the voiceover stage exactly:

```
generateScript -> attachVoiceover -> attachCaptions -> bundle -> renderMedia
```

`attachVoiceover` writes `audioSrc` and rewrites `durationInFrames`.
`attachCaptions` reads the same WAV back, sends it to Groq Whisper, and stamps a
`captions` array onto the scene. Remotion receives fully-resolved word timings
and stays declarative: no network, no filesystem, no knowledge of transcription.

Scene duration is **not** recalculated from captions. Voiceover already set it
from the measured clip length, and captions must not become a second source of
truth for timing.

## Components

| Path | Responsibility |
|---|---|
| `src/services/transcribe.ts` | Groq Whisper request and error mapping. |
| `src/services/caption-groups.ts` | Pure grouping of words into on-screen chunks. Browser-safe. |
| `src/pipeline/captions.ts` | Per-scene orchestration: transcribe, cache, attach. |
| `src/components/Captions.tsx` | Renders the active chunk and highlights the active word. |
| `src/types/video.ts` | `captions` field on the scene schema. |
| `src/components/Scene.tsx` | Mounts `Captions`. |
| `src/components/AnimatedText.tsx` | Hides `subtext` when captions are present. |

### Data shape

```ts
export type CaptionWord = {
  word: string;
  start: number; // seconds, relative to the start of the scene's audio clip
  end: number;
};
```

Added to `videoSceneSchema` as an optional array, written only by the captions
stage. Times are relative to the clip, not to the scene, because that is what
Whisper returns and it keeps the stored data independent of `LEAD_IN_SECONDS`.

### Transcription

- Endpoint: `POST https://api.groq.com/openai/v1/audio/transcriptions`
- Model: `whisper-large-v3-turbo`, overridable with `TRANSCRIBE_MODEL`
- Multipart body: `file` (the WAV), `model`, `response_format=verbose_json`,
  `timestamp_granularities[]=word`
- Auth: `LLM_API_KEY`, the same key used for scripts and speech. No new key.
- Response: `{ words: [{ word, start, end }], duration, text }`

Verified live against a synthesized clip: the returned `duration` matched the
WAV header measurement to four decimal places and every word carried a start
and an end.

### Grouping

Whisper returns one entry per word. Showing one word at a time loses context, so
`groupCaptionWords` batches them into chunks. A chunk closes when any of these
is true:

- it holds `MAX_WORDS_PER_GROUP` (4) words;
- the word just added ends a sentence (its text ends with `.`, `!` or `?`,
  ignoring trailing quotes and brackets);
- adding another word would push the chunk past `MAX_GROUP_SECONDS` (2.5).

Each chunk records `start` (its first word's start) and `end` (its last word's
end). Grouping is a pure function with no Node imports, so `Captions.tsx` can
import it directly — the same constraint that put timing constants in their own
module in Phase 8.

### Rendering

`Captions.tsx` converts clip-relative seconds to scene frames:

```
frame = round((LEAD_IN_SECONDS + seconds) * fps)
```

`LEAD_IN_SECONDS` comes from `src/services/timing.ts`, the module that already
delays the audio by the same amount. There is one lead-in constant in the
codebase and both consumers read it.

A chunk is on screen from its own start frame until the next chunk's start
frame, so there is no flicker in the pause between chunks. The last chunk holds
until the end of the scene. Within the visible chunk, the word whose
`[start, end)` window contains the current frame is drawn in the scene's
`themeColor`; the rest are white.

Layout: bottom third of the frame, centred, uppercase, weight 800, 44px, with a
dark text shadow for legibility over bright gradients. Maximum width 820px so
lines wrap inside the vertical safe area.

### Interaction with existing text

`subtext` is hidden whenever the scene has captions, and drawn as before when it
does not. Both the schema field and the prompt instruction stay: a payload
rendered with `--no-audio` still fills the frame, and a captioned render is not
crowded by two competing lines of prose.

## Caching

The transcript is cached beside its audio: a scene whose clip is
`public/audio/<key>.wav` stores its words in `public/audio/<key>.json`. The key
is the existing content hash of narration, voice and model, so a cached clip
always has a cached transcript and an edited narration invalidates both. The
directory is already gitignored.

## Error handling

A transcription failure aborts the render, matching the voiceover rule: never
silently ship a degraded video. `describeTranscribeError` maps the status to an
actionable message — 401/403 points at `LLM_API_KEY`, a rate limit says to
retry, and anything else carries the truncated response body.

A scene with no narration has no clip and therefore no captions; it is skipped
without an error. `--no-audio` skips synthesis, so there is nothing to
transcribe and the stage does no work and makes no network calls.

## Testing

Unit tests cover the pure logic and the error mapping, following the Phase 8
pattern. Network calls are not unit tested; they are covered by live end-to-end
verification at the end of implementation.

- `caption-groups`: empty input, a single word, the four-word cap, a sentence
  break before the cap, a duration break before the cap, and correct chunk
  start/end times.
- `transcribe`: authentication failure, rate limit, unrecognised failure, and
  rejection of a response containing no word timings.

Live verification: render the example payload, confirm captions appear in the
`out/` MP4 and that a second run reports cached transcripts with no network
delay.

## Out of scope

Translation, multi-language captions, a sidecar `.srt` or `.vtt` file, and
speaker labels. Background music and visual b-roll remain separate future work.
