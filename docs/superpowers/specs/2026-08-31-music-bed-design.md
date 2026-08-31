# Music Bed Design

**Date:** 2026-08-31
**Status:** Approved

## Problem

Every finished video is speech over silence. Between sentences, and in the
lead-in and tail of every scene, the soundtrack drops to nothing, which reads as
a recording rather than as a piece. A quiet musical bed under the whole video
fills those gaps and holds the scenes together across the dissolves.

## Decision: synthesize the bed, do not source it

The project generates its visuals rather than searching stock libraries, and the
soundtrack follows the same rule: the bed is synthesized in Node from the
payload's own seed. No download, no API key, no licence to track, no new
dependency — the same reasons that ruled out stock footage and paid image
models.

This buys an ambient pad, not a produced track. That is the right instrument for
the job: it sits under narration, carries no rhythm to fight the captions, and
needs no attribution.

## Architecture

Music is a **pipeline stage**, like imagery, not a render-time computation:

```
generateScript → attachVoiceover → attachCaptions → attachImagery → attachMusic → renderMedia
```

`attachMusic` runs last because it needs the finished timeline: scene durations
are only known once the voiceover stage has measured the speech.

Four units, split along the Node/browser boundary that already governs this
codebase:

| Unit | Side | Responsibility |
|---|---|---|
| `src/services/music-gen.ts` | Node | Synthesize PCM and write a WAV file. No knowledge of scenes. |
| `src/pipeline/music.ts` | Node | Decide the length and the seed, cache, set `musicSrc`, never fail a render. |
| `src/services/music.ts` | Browser-safe | The gain envelope: fades and ducking, as pure functions of frame. |
| `src/components/MusicBed.tsx` | Browser | One `<Audio>` for the whole composition, volume driven by `music.ts`. |

`src/services/music.ts` is imported by a bundled component, so — like
`timing.ts` — it must not import `node:*` or `dotenv`.

### The sound

Deterministic from `seedFromId(payload.title)`, so re-rendering the same video
gives the same bed.

- A root pitch drawn from a fixed low set (A2–D3 range), and two chords built on
  it — a minor triad and the major chord a major third below — alternating every 8 seconds
  with an 8-second crossfade, so the harmony moves without ever landing on a
  beat.
- Each voice is a sine plus a quiet octave partial, with a slow independent
  tremolo (0.05–0.12 Hz) so the texture breathes.
- Stereo, with the two channels detuned by a few cents for width.
- 44.1 kHz, 16-bit PCM, written as a WAV by hand: the header is 44 bytes and
  writing it needs no library.
- Peak-normalized, then a 1.5-second fade at each end of the file itself, on top
  of the render-time envelope.

The file is synthesized to the exact length the video needs, so nothing has to
loop.

### The envelope

`musicGain(frame, spans, totalFrames, fps)` returns the volume Remotion asks for
on each frame:

- **Base gain** 0.18 — present but never competing with narration.
- **Ducked gain** 0.05 while anyone is speaking, reached over a 0.18-second ramp
  that starts *before* the speech does, so the duck never clips the first word.
- **Fades** of 1 second at the start and end of the video.

The ramp is short for a reason. The only silence between two scenes is the tail
plus the lead-in minus the dissolve — 0.45 seconds — so a ramp of the half
second a mixing desk would use never finishes in either direction, and the bed
sits ducked for the entire video without once reaching its base gain.

Speech spans come from the caption word timings where the captions stage has
produced them, so a genuine pause inside a scene opens the bed too. Without
timings the whole padded middle of the scene counts as speech, which is the safe
assumption. Spans closer together than `MIN_OPEN_SECONDS` (0.4) are merged: a
lift shorter than a ramp out and back in is heard as a wobble, not a breath.
Scenes with no `audioSrc` contribute no span, so `--no-audio` renders play the
bed at full base gain throughout.

## Caching

`public/music/<key>.wav`, gitignored, where the key is a 16-character hash of
the seed, the duration in frames, the fps and a format version. Two renders of
the same video reuse one file; changing the length or the synthesis version
writes a new one.

## Failure behaviour

Music can never fail a render. Any error — unwritable directory, bad duration,
anything thrown by the synthesizer — is caught in `attachMusic`, logged as
`[music] falling back (<reason>)`, and the payload is returned without
`musicSrc`. The composition renders silent-but-for-speech, exactly as it does
today.

## Interface changes

- `videoPayloadSchema` gains `musicSrc: z.string().optional()`, written by the
  music stage. Relative to `public/`, e.g. `music/9f2a1c.wav`.
- `parseArgs` gains `music: boolean`, set false by `--no-music`.
- `renderVideo` options gain `music?: boolean`.

## Testing

`node:test`, no network, no audio playback:

- The gain functions: base gain in a gap, ducked gain mid-speech, monotone ramp
  in and out, fades at both ends, empty spans, spans that touch, a video
  shorter than the fades.
- The synthesizer: a valid RIFF/WAVE header, the requested duration in samples
  (within one frame), determinism for one seed, difference across seeds, no
  sample outside [-1, 1] once decoded.
- The stage: writes once and reuses the cache, returns the payload untouched on
  error, never throws.

## Out of scope

Per-scene music changes, a user-supplied track folder, tempo matched to speech
rate, and any form of mastering. If the pad proves too plain, the synthesizer is
one file and can be replaced without touching the stage, the envelope or the
component.
