# AI Agent Roadmap: Automated Video Pipeline with Remotion + Groq

## Objective
Build an autonomous Node.js/TypeScript pipeline that takes a user topic, transforms it into structured scene data (JSON) via an LLM, narrates and captions it, and dynamically renders the data into an MP4 video using Remotion.

> Phases 1-4 were built against the Gemini API, which was the original target.
> Phase 7 moved script generation behind a provider seam and made Groq the
> default; Gemini is now one option among several. Those early phases are left
> as written, to record what was built when.

---

### Phase 1: Environment Setup & Dependencies
- [x] Initialize a new Remotion TypeScript template (`npx create-video@latest`).
- [x] Install required dependencies:
  - `@google/genai` (Official Gemini API client)
  - `@remotion/renderer` and `@remotion/bundler` (Headless programmatic rendering)
  - `dotenv`, `zod` (Environment management and schema validation)
- [x] Create a `.env.example` file containing `GEMINI_API_KEY=`.
- [x] Configure `tsconfig.json` to ensure seamless compatibility with Node.js ES Modules.

---

### Phase 2: Data Schema & Type Definitions (`src/types/video.ts`)
- [x] Define Zod schemas and TypeScript types for the scene-based video structure:
  - `VideoScene`: `id`, `text`, `subtext`, `durationInFrames`, `themeColor`, `keywords`.
  - `VideoPayload`: `title`, `fps`, `scenes` (Array of `VideoScene`), `aspectRatio` (e.g., `9:16`).
- [x] Export `inputProps` type contracts consumed by Remotion compositions.

---

### Phase 3: Modular Remotion Components Development
- [x] `src/components/Scene.tsx`: Create a scene component utilizing `useCurrentFrame`, `spring`, and `interpolate` for smooth visual transitions.
- [x] `src/components/AnimatedText.tsx`: Create a modular typography component supporting fade-in and spring scale animations.
- [x] `src/VideoRoot.tsx`:
  - Implement a dynamic sequence flow using `<TransitionSeries>` or sequential `<Sequence>` blocks based on incoming `scenes`.
  - Use `calculateMetadata` to calculate total `durationInFrames` dynamically from the input payload.
- [x] `src/Root.tsx`: Register the `<Composition />` configured with complete `defaultProps` for local Remotion Studio previewing.

---

### Phase 4: Gemini Integration Module (`src/services/gemini.ts`)

_Superseded by Phase 7: Gemini is now one provider among several and no longer the default._
- [x] Implement an initialization service wrapping `@google/genai`.
- [x] Configure the `gemini-2.5-flash` model with `JSON Mode` and strict `responseSchema`:
  - System Prompt: "Generate a high-engagement social media video script split across 3 distinct scenes (3-4 seconds each) with visual color accents and punchy copy."
- [x] Validate raw API output against the Phase 2 Zod schema, including structured error handling and fallbacks.

---

### Phase 5: Rendering Engine & Orchestration CLI (`src/pipeline/render.ts`)
- [x] Bundle the Remotion root using `bundle()` into a temporary build location.
- [x] Load dynamic composition metadata using `selectComposition()`.
- [x] Execute `renderMedia()` to export the final `.mp4` file into the `out/` directory.
- [x] Add real-time render progress tracking (`onProgress`) with console output.

---

### Phase 6: Testing & Validation
- [x] Execute an offline rendering smoke test with static mock JSON: `npm run test:render`.
- [x] Execute the full end-to-end flow with a payload file (no API key required): `node run.mjs --payload scripts/example-payload.json`.
- [x] Execute the full end-to-end flow against a live provider: `node run.mjs --topic "The Future of AI"` with `SCRIPT_PROVIDER=groq`. Verified output: 1080x1920, 30fps, h264, 10s.

---

### Phase 7: Pluggable Script Providers
- [x] Extract the shared prompt, JSON schema, and validation into `src/services/script-schema.ts`.
- [x] Add `src/services/openai-compatible.ts`, a dependency-free adapter for any OpenAI-compatible endpoint (Groq, OpenRouter, OpenAI, Ollama) with `json_schema` output and a `json_object` fallback.
- [x] Add `src/services/script-provider.ts` to dispatch on `SCRIPT_PROVIDER` and to load hand-authored payload files.
- [x] Support `--payload <file.json>` in the CLI so videos can be rendered with no LLM API at all.
- [x] Add a repair retry that feeds schema validation errors back to the model.
- [x] Default Groq to `openai/gpt-oss-120b`; the previous `llama-3.3-70b-versatile` was retired from the catalogue.
- [x] Verify output video specifications (resolution, frame rate, asset sync, render duration) for the offline smoke render.

---

### Phase 8: Voiceover Audio
- [x] Add `narration` to the scene schema and the generation prompt.
- [x] Synthesize per-scene speech through Groq, reusing `LLM_API_KEY`.
- [x] Measure each clip from its WAV header with no added dependency.
- [x] Rewrite `durationInFrames` from measured speech length.
- [x] Cache clips by content hash so unchanged narration is never re-synthesized.
- [x] Support `--no-audio` for offline, network-free renders.

---

### Phase 9: Spoken-Word Captions
- [x] Transcribe each narration clip through Groq Whisper, reusing `LLM_API_KEY`.
- [x] Store word timings on the scene, relative to its audio clip.
- [x] Group words into readable chunks and highlight the spoken word.
- [x] Cache transcripts beside their clips so a rerun makes no network call.
- [x] Hide the model-written subtitle when captions are present.
