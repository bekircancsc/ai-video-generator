# Niche Briefs and Variable Scene Count Design

**Date:** 2026-08-31
**Status:** Approved

## Goal

Let a run be described by a niche rather than only a single topic, and let a
video run longer than three scenes.

Two commands that do not work today:

```bash
npm run start -- --niche "stoic philosophy for busy men"
npm run start -- --topic "Amor fati" --scenes 6
```

The first should have the model choose a topic inside that niche. The second
should produce a six-scene video instead of the three the schema currently
hard-codes.

## Background

Everything from the CLI down to the prompt carries a single `topic: string`.
That string is the entire brief: there is nowhere to say who the video is for,
what register to write in, or how long it should be. And
`videoPayloadJsonSchema` pins `scenes` to `minItems: 3, maxItems: 3`, so every
render is roughly ten to thirty seconds regardless of how much the subject
needs.

Both limits sit in the same two files, and both are really the same problem: the
generation stage takes one positional string where it wants a brief.

## The brief

A single object replaces the bare string across the generation seam:

```ts
export type ScriptBrief = {
  topic?: string;
  niche?: string;
  sceneCount?: number;
};
```

It threads through `buildScriptPrompt`, `generateScript`,
`generateWithOpenAICompatible` and `generateVideoPayload`. Adding a fourth field
later — a voice, a target duration, a language — costs no signature change
anywhere.

At least one of `topic` or `niche` must be present. That is a CLI-level check,
not a schema one: a `--payload` run has neither and is still valid.

## Prompt

`buildScriptPrompt(brief)` writes one of three openings and keeps the rest of
today's wording — the copy limits, the write-for-the-eye and write-for-the-ear
rules, the continuous-voiceover instruction — unchanged.

| Brief | Opening |
|---|---|
| topic only | Today's line, verbatim. |
| niche only | Pick one specific, high-engagement topic within the niche, then write the script for it. |
| both | Write about the topic, for the niche's audience; match its tone and vocabulary. |

Scene count adds one further sentence: an exact count when `sceneCount` is set,
otherwise an instruction to choose between three and eight scenes according to
how much the topic needs.

## Enforcing the count

The count is enforced twice, because the strict-schema path is not always
available.

`videoPayloadJsonSchema` stops being a frozen constant and becomes
`buildVideoPayloadJsonSchema(sceneCount?)`. With a count it emits
`minItems: n, maxItems: n`; without one, `minItems: 3, maxItems: 8`. This is the
strong path: on an endpoint that honours `response_format: json_schema`, a wrong
count cannot be returned at all.

The `json_object` fallback has no such guarantee, so `parseScriptJson(raw, {
sceneCount })` re-checks after Zod validation and throws when the count is
wrong: against the exact number when the brief names one, against the three-to-
eight range when it does not. That throw is not a dead end: `generateWithOpenAICompatible` already
feeds validation messages back to the model as a repair retry, so a miscount
gets one correction attempt with the specific error attached.

Called with no options at all — which is how `loadPayloadFile` calls it — it
checks no count. The range applies to generated scripts only.

The Zod schema in `types/video.ts` keeps `scenes.min(1)` and gains no upper
bound. The three-to-eight range is a rule about what the model may write, not
about what the renderer can draw; a hand-written `--payload` file with twelve
scenes stays legal.

## CLI

Two flags join `--topic`, `--payload` and `--no-audio`:

| Flag | Effect |
|---|---|
| `--niche <value>` | The audience and register to write for. Alone, the model also picks the topic. |
| `--scenes <n>` | Exact scene count. Integer, 3 to 8. |

`--scenes` is validated at parse time; a non-integer or out-of-range value fails
immediately with a message naming the allowed range, rather than after a model
call. The "a topic must be provided" error grows to mention `--niche`.

The output filename is `slugify(topic)` today. A niche-only run has no topic, so
the name is resolved after generation from `topic ?? payload.title` — the model
already writes a title, and it describes the chosen subject better than the
niche would.

## Moving `parseArgs`

`parseArgs` lives in `pipeline/render.ts`, which imports `@remotion/bundler` and
`@remotion/renderer` at module scope. Testing argument parsing there means
pulling a bundler into a unit test.

It moves to `src/services/cli-args.ts`, matching how every other single concern
in this codebase is already filed, and `render.ts` imports it. No behaviour
change beyond the two new flags.

## Testing

Two new test files, both offline:

- `services/cli-args.test.ts` — each flag parses; a bare positional is still the
  topic; `--scenes` rejects `0`, `9`, `abc` and a missing value; topic and niche
  combine.
- `services/script-schema.test.ts` — the three prompt shapes each mention what
  they should; `buildVideoPayloadJsonSchema` pins the count when given and
  spans 3 to 8 when not; `parseScriptJson` rejects a payload whose scene count
  contradicts the brief and accepts one that matches.

Both are added to the `npm test` list. `npm run test:render` continues to prove
the render path end to end without a network call.

## Out of scope

Turkish narration and any non-English voice. The prompt, the TTS voices and the
Whisper model stay English.
