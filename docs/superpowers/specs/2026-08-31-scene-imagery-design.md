# AI Scene Imagery

## Problem

Every video the pipeline renders looks the same. Script, voiceover and
word-synced captions all derive from the topic, but the only visual is the
procedural aurora background, so nothing on screen *shows* the subject.

Stock footage was considered first and set aside: the visuals are generated
here, not searched for. Real AI video clips (Veo, Kling) were set aside as
costly and slow. This design covers the middle path: one generated still per
scene, moved by the renderer.

## Scope

- One image per scene, generated from a per-scene prompt, cached on disk.
- Free image providers only. Default provider needs no API key.
- The image becomes the scene background, under a darkening layer, with a
  slow zoom. The aurora background stays as the fallback.
- `src/services/gemini.ts` is not touched.

Out of scope: animated clips, per-scene style overrides, image editing or
upscaling, a second image per scene.

## Architecture

Imagery is a **pipeline stage**, not a render-time fetch. The stage runs before
bundling, writes files into `public/images/`, and records the relative path on
the scene. Remotion then reads a local file through `staticFile()`.

```
generateScript → attachVoiceover → attachCaptions → attachImagery → renderMedia
```

Remotion renders frames across several headless browser tabs, so a fetch inside
a component would re-download the same image many times and make renders flaky.
Generating ahead of the render keeps the render deterministic and offline.

New units:

| File | Responsibility |
| --- | --- |
| `src/services/image-prompt.ts` | Scene → final prompt text. Pure. |
| `src/services/image-gen.ts` | Provider dispatch + HTTP. Returns image bytes. |
| `src/pipeline/imagery.ts` | Cache lookup, generation, `imageSrc` attachment. |

`src/services/clip-paths.ts` gains an image cache-key helper beside the
narration one, so both caches share a convention.

### Prompt construction (`image-prompt.ts`)

```ts
buildImagePrompt(scene: VideoScene): string
```

- Subject comes from `scene.imagePrompt` when the model wrote one, otherwise
  from `scene.keywords.join(", ")`, otherwise from `scene.text`.
- A fixed style block is appended to every prompt so all scenes of a video read
  as one piece: cinematic, dark, high-contrast, shallow depth of field,
  vertical composition, no text, no watermark, no recognisable real people.
- The function is pure and fully unit-tested; no network, no environment.

### Providers (`image-gen.ts`)

`IMAGE_PROVIDER` selects the backend, mirroring `SCRIPT_PROVIDER`:

- `pollinations` (default) — keyless. `GET https://image.pollinations.ai/prompt/<encoded>?width=1080&height=1920&model=flux&nologo=true&seed=<n>`; the response body is the image. The seed is derived from the scene id, so a rerun without a cache reproduces the same picture.
- `together` — requires `IMAGE_API_KEY`; without it the stage reports a missing-key message and the scene falls back. `POST https://api.together.xyz/v1/images/generations` with `black-forest-labs/FLUX.1-schnell-Free`, 768×1344 (FLUX requires multiples of 16), reading the base64 field of the response.
- `none` — generation is skipped entirely.

`IMAGE_MODEL` overrides the selected provider's default model (`flux` for pollinations, `black-forest-labs/FLUX.1-schnell-Free` for together).

Every provider returns the raw image bytes as a `Buffer`. Failures throw
a message that names the provider and what to do next, following the shape of
`describeTtsError`.

### Cache and attachment (`imagery.ts`)

```ts
attachImagery(payload: VideoPayload): Promise<VideoPayload>
```

- Cache key: `sha256(prompt + provider + model + dimensions)`, first 16 hex
  characters, matching `narrationCacheKey`.
- Path: `public/images/<key>.jpg`. A cache hit makes no network call.
- On success the scene gets `imageSrc: "images/<key>.jpg"` (relative to
  `public/`, because `staticFile()` resolves there).
- On **any** failure — provider error, timeout, empty body, missing key — the
  stage logs one line and leaves the scene without `imageSrc`. The render
  continues with the aurora background. Imagery never fails a render.
- Progress logging matches the voiceover stage: `[imagery] <scene id>: cached |
  generating | falling back (<reason>)`.

## Data

`videoSceneSchema` gains two optional fields, so existing `--payload` files and
cached scripts keep validating:

```ts
imagePrompt: z.string().default(""),   // written by the script model
imageSrc: z.string().optional(),       // written by the imagery stage
```

The script JSON schema and prompt in `script-schema.ts` ask for `imagePrompt`:
one sentence describing what the viewer should see in that scene, concrete and
filmable, no text in the image.

## CLI and configuration

- `--no-images` skips the stage, mirroring `--no-audio`. Parsed in
  `cli-args.ts` and covered by its tests.
- `.env.example` gains:

```
# Scene imagery. pollinations (keyless, default) | together | none
IMAGE_PROVIDER=pollinations
IMAGE_API_KEY=
IMAGE_MODEL=
```

## Rendering

`Background.tsx` takes an optional `imageSrc` and branches:

- **With an image:** `<Img src={staticFile(imageSrc)}>` fills the frame
  (`objectFit: cover`), scaled from 1.0 to 1.08 across the scene's own duration
  so short and long scenes drift alike — the same normalisation the aurora
  clouds already use. Over it: a vertical dark gradient (roughly 55% at the
  centre, heavier top and bottom where the badge and captions sit), then the
  existing grain and vignette layers, unchanged.
- **Without an image:** today's aurora, untouched.

The scene's `themeColor` keeps driving the text, badge and caption highlight, so
a video still reads as one palette.

## Testing

Unit tests, no network, following the existing `node:test` pattern:

- `image-prompt.test.ts` — subject fallback order, style block always appended,
  empty scenes handled.
- `image-gen.test.ts` — provider dispatch, unknown provider message, missing key
  message, error mapping; `fetch` stubbed.
- `imagery.test.ts` — cache hit makes no call, success writes the path, provider
  failure leaves the scene untouched and does not throw, `IMAGE_PROVIDER=none`
  short-circuits.
- `cli-args.test.ts` — `--no-images`.

Manual verification: one render with `--payload scripts/example-payload.json`
(images on) and one with `--no-images`, confirming both produce a 1080×1920
H.264 file and that the text stays legible over the generated frames.

## Risks

- **Pollinations has no uptime guarantee.** Mitigated by the silent aurora
  fallback and by the disk cache; a failed image costs nothing but a plain
  background.
- **Generation latency adds to render time.** Roughly a few seconds per scene,
  once, and never again for the same prompt.
- **Prompt drift between scenes.** Mitigated by the shared style block.
