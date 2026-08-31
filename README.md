# ai-video-generator

Turns a topic into a finished vertical video. An LLM writes the script, Groq
synthesizes the voiceover, Groq Whisper times every spoken word, and Remotion
renders the result to MP4.

Output is 1080×1920 at 30fps, H.264 with an AAC voiceover track and
word-synchronised captions. Scene length is not fixed: each scene runs exactly
as long as its narration takes to speak.

```bash
npm run start -- --topic "Why Short Videos Win"
# out/why-short-videos-win.mp4
```

## Quick start

Requires Node 22 or newer.

```bash
npm install
cp .env.example .env
```

Put a [Groq API key](https://console.groq.com/keys) in `.env` as `LLM_API_KEY`.
One key covers all three services — script, speech and transcription. The free
tier is enough to render.

The speech model needs its terms accepted once, in the
[Groq console](https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english).
Skip it and the first render fails with a message pointing back here.

```bash
npm run start -- --topic "The Future of AI"
```

Or with an audience and exact scene count:

```bash
npm run start -- --niche "stoic philosophy for busy men" --scenes 6
```

No key handy? Render the bundled script instead — this path makes no network
call at all:

```bash
npm run start -- --payload scripts/example-payload.json --no-audio
```

## How it works

```
topic ─▶ script ─▶ voiceover ─▶ captions ─▶ imagery ─▶ render ─▶ out/*.mp4
```

| Stage | Module | What it produces |
|---|---|---|
| Script | `src/services/script-provider.ts` | A validated `VideoPayload`: three to eight scenes, each with on-screen text and a `narration` line written for the ear. |
| Voiceover | `src/pipeline/voiceover.ts` | One WAV per scene in `public/audio/`. Measures each clip from its RIFF header and rewrites `durationInFrames` to fit the speech. |
| Captions | `src/pipeline/captions.ts` | Word-level timings from Groq Whisper, cached beside the clip and stamped onto the scene. Never changes scene length. |
| Imagery | `src/pipeline/imagery.ts` | One generated still per scene in `public/images/`, drawn full-frame under a darkening scrim with a slow zoom. A scene without one falls back to the drawn aurora background. |
| Render | `src/pipeline/render.ts` | Bundles the Remotion composition and writes the MP4 to `out/`. |

Two rules hold the design together:

**Speech drives timing.** The voiceover stage is the only thing that sets scene
duration, measured from the actual audio plus a 0.25s lead-in and a 0.5s tail.
Captions read those clips but never touch the timing.

Consecutive scenes then overlap by `TRANSITION_SECONDS` (0.3s) and cross-dissolve
into each other, so the finished video runs `(scenes - 1) * 0.3s` shorter than
the sum of its scene durations. The overlap fits inside the 0.5s tail silence
every clip already carries, so no speech is lost. `src/services/timing.ts` is
the one place that arithmetic lives.

**The React side stays declarative.** Everything under `src/components/` is
bundled for the browser by Remotion, so nothing there may import a module that
touches `node:fs`, `node:crypto` or `dotenv`. Pipeline stages resolve all the
data first; components only draw what they are handed.

## CLI

```bash
npm run start -- [--topic <topic>] [--niche <niche>] [--scenes <n>] [--payload <file.json>] [--no-audio] [--no-images]
```

| Flag | Effect |
|---|---|
| `--topic <topic>` | The subject to generate a script about. A bare positional argument works too. |
| `--niche <niche>` | Who the video is for. On its own, the model also picks the topic. With `--topic`, it sets the audience and tone. |
| `--scenes <n>` | Exact number of scenes, 3 to 8. Left off, the model picks a number to suit the topic. |
| `--payload <file>` | Render a hand-written script instead of calling an LLM. See `scripts/example-payload.json`. |
| `--no-audio` | Skip voiceover and captions entirely. No network calls; scenes keep the durations in the payload. |
| `--no-images` | Skip image generation. Every scene renders the drawn aurora background instead. |

| Script | Purpose |
|---|---|
| `npm run start` | Generate and render. The main entry point. |
| `npm run dev` | Open Remotion Studio to preview and scrub the composition. |
| `npm test` | Unit tests, via the built-in Node test runner. |
| `npm run build` | Typecheck only (`tsc --noEmit`). |
| `npm run test:render` | Offline smoke render from a mock payload. Makes no network calls. |

## Configuration

All settings live in `.env`. Only `LLM_API_KEY` is required.

| Variable | Default | Notes |
|---|---|---|
| `SCRIPT_PROVIDER` | `groq` | `groq`, `openrouter`, `openai`, `ollama`, `gemini`, or `manual`. `manual` requires `--payload`. |
| `LLM_API_KEY` | — | Used by the script, speech and caption stages alike. |
| `LLM_BASE_URL` | provider default | Override the endpoint. Rarely needed. |
| `LLM_MODEL` | provider default | Groq defaults to `openai/gpt-oss-120b`. On a bad model name the error lists the provider's real catalogue. |
| `GEMINI_API_KEY` | — | Only when `SCRIPT_PROVIDER=gemini`. |
| `TTS_VOICE` | `daniel` | One of `autumn`, `diana`, `hannah`, `austin`, `daniel`, `troy`. |
| `TTS_MODEL` | `canopylabs/orpheus-v1-english` | Groq speech model. |
| `TRANSCRIBE_MODEL` | `whisper-large-v3-turbo` | Groq transcription model. |
| `IMAGE_PROVIDER` | `pollinations` | `pollinations` (needs no key), `together`, or `none` to keep the drawn background. |
| `IMAGE_API_KEY` | — | Only when `IMAGE_PROVIDER=together`. |
| `IMAGE_MODEL` | provider default | `flux` on pollinations, `black-forest-labs/FLUX.1-schnell-Free` on together. |

Any OpenAI-compatible endpoint works through the same adapter. Pointing
`SCRIPT_PROVIDER=ollama` at a local model needs no key at all.

## Caching

Generated audio and transcripts live in `public/audio/`, and generated images in
`public/images/`. Both are gitignored.
Nothing there is precious — deleting the directory only costs you the time to
regenerate it.

A clip is named after a hash of its narration text, voice and speech model, so
editing a line of narration produces a new file and leaves the old one behind.
Its transcript sits beside it, named with the transcription model as well.
Change any of those inputs and the affected stage re-runs; change nothing and a
second render makes no network calls.

An image is named after a hash of its prompt, provider, model and frame size,
so two scenes asking for the same picture share one file, and switching
provider or model regenerates rather than reusing.

Superseded files are never cleaned up automatically. To reclaim the space:

```bash
rm -rf public/audio public/images
```

## Failure behaviour

A failing stage aborts the render rather than degrading the output — a video
that silently ships without its voiceover or captions is worse than no video.
Errors carry the next step: a rejected model name lists the real catalogue, a
rejected voice lists the valid voices, and an unaccepted speech model links to
the console page that accepts it.

Imagery is the one exception. A picture that cannot be generated — a provider
error, a timeout, a missing key — logs one line and leaves that scene on the
drawn aurora background. The render still succeeds, because a video that looks
like last month's is better than no video at all.

## Development

```bash
npm test          # unit tests
npm run build     # typecheck
npm run test:render   # offline end-to-end render, no network
```

Tests cover the pure logic: WAV header parsing, timing arithmetic, caption
grouping, cache paths, and error mapping. Network calls are verified by running
the real pipeline, not by mocks.

Design documents and implementation plans are in `docs/superpowers/`, and
`roadmap.md` tracks what has been built.
