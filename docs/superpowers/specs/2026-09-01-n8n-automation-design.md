# n8n Automation Design

**Date:** 2026-09-01
**Status:** Approved

## Problem

The pipeline turns a topic into a finished MP4 and a cover, and then stops. Every
run is a command someone types, and every upload is a file someone drags into
YouTube Studio with a title and description written by hand. The generator is
automatic; the channel around it is not.

The gap is not the rendering. It is everything on either side of it: deciding
what this week's video is about, giving YouTube the metadata, putting the cover
on the video, and saying that it happened.

## Decision: n8n orchestrates, the CLI produces

n8n schedules the run, calls the existing CLI once, uploads what comes back, and
sends a message. It does not generate anything itself.

The alternative — modelling each stage as its own n8n node, with the script LLM
call, the speech call and the image calls drawn on the canvas — was rejected.
The pipeline already owns that sequence, along with the caching, the timing
arithmetic and the failure rules, and all of it is under test. Splitting it
across two systems would put the same logic in two places, leave the tests
covering only half of it, and break the content-addressed caches that make a
second render free. The canvas would be prettier and the system would be worse.

So the boundary is a single command, and the contract across it is one line of
JSON.

## Where it runs

n8n is installed natively on the same Windows machine as the repo (`npm i -g
n8n`), not in Docker. The Execute Command node has to see this repo, this Node
installation and ffmpeg; inside a container it sees none of them. The cost of
that choice is that videos are only produced while the machine is on, which is
acceptable for a weekly cadence.

## Repo changes

Four additions, all small, none of which change how the pipeline behaves when
run by hand.

### `--niche-file <path.md>`

`src/services/cli-args.ts` gains a flag that reads a Markdown file and passes its
contents as `ScriptBrief.niche`. Passing both `--niche` and `--niche-file` is an
error; an unreadable file is an error naming the resolved path.

The niche is a document rather than a phrase because that is what a channel
actually is: audience, tone, recurring format, things to avoid. The file lives at
`niches/floor-four.md` and is the one place the channel is defined.

`briefLines()` in `src/services/script-schema.ts` today interpolates the niche
into a quoted sentence. A multi-line value renders instead as its own labelled
block, so the brief reads as a brief and not as a runaway string literal. The
single-line form is untouched.

### `youtube` on the payload

`src/types/video.ts` gains:

```ts
youtube: z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
}).optional()
```

`optional` in zod so `scripts/example-payload.json` and every hand-written
payload stay valid; `required` in the JSON Schema that
`buildVideoPayloadJsonSchema` hands the model, so a generated script always
carries one. The prompt gains three lines describing what each field is for: a
title written for a browse thumbnail, a description written for someone deciding
whether to watch, tags that are search terms rather than adjectives.

The metadata comes from the script model rather than a second LLM call in n8n
because it is the same act of authorship — the model that decided what the video
says is the one that knows how to sell it, and one call cannot drift from the
other.

When the field is absent the result builder falls back: title from
`payload.title`, description from the scene narrations joined, tags from the
scene keywords. A hand-written payload therefore still uploads.

### `--json`

With this flag, `src/pipeline/render.ts` writes **only** the result object to
stdout and routes every progress log to stderr. Success:

```json
{"ok":true,"mp4":"out/x.mp4","cover":"out/x.jpg","slug":"x",
 "title":"…","description":"…","tags":["…"],"durationSeconds":47.2}
```

Failure: `{"ok":false,"error":"…"}` on stdout, exit code 1.

Two streams rather than one, because the Execute Command node in n8n exposes
stdout and stderr separately. Machine output on one and human output on the
other means the workflow parses a whole stdout with `JSON.parse` instead of
hunting for the last line that happens to look like JSON among the Remotion
progress lines. The render logs are not lost — they are in stderr, where a
failed run's message is read from.

`cover` is omitted when `--no-cover` was passed or the cover stage fell back.
Paths are relative to the repo root.

### `history.json`

A tracked file at the repo root. Each successful render appends
`{date, slug, title, topic}`.

On the next run the last 40 entries are read and passed as
`ScriptBrief.avoidTopics`, which the prompt renders as a list the model is told
not to repeat. With a fixed niche and no other input, a model asked to pick a
topic will otherwise converge on the same three or four ideas within a month.

Tracked in git rather than gitignored because the list of what the channel has
published is worth keeping, and it is the only record of it outside YouTube.

The append happens in the direct-run path of `render.ts`, after a successful
render, not inside `renderVideo` — the exported function stays free of side
effects so the tests and the offline smoke render do not write to it.

## The workflow

```
Schedule Trigger  (weekly)
  → Execute Command
        cwd: <repo root>
        npm run start -- --niche-file niches/floor-four.md --json
  → Code: JSON.parse(stdout); throw when ok is false
  → Read Binary File: the mp4
  → YouTube: video upload — privacy "private", title, description, tags
  → HTTP Request: POST youtube/v3/thumbnails/set with the cover jpg
  → Telegram: "ready → https://youtube.com/watch?v=…"

Error Trigger → Telegram: the error line
```

The thumbnail is a raw HTTP Request rather than a node operation because the
YouTube node in n8n has no thumbnail action. It reuses the same YouTube OAuth2
credential.

The video is uploaded private and left there. Nothing this workflow produces
reaches an audience without someone looking at it first: an automated channel
that publishes straight to public is one bad render away from doing damage that
takes longer to undo than the review would have cost.

## Credentials

YouTube OAuth2 (a Google Cloud project with YouTube Data API v3 enabled) and the
Telegram bot token live in the n8n credential store. Neither goes in `.env`, and
the repo never reads them — the generator has no idea a channel exists.

Quota note: an upload costs 1600 units against a default 10,000/day, so roughly
six videos a day. Weekly runs are nowhere near it.

## Failure behaviour

The existing rule carries over unchanged: a failing production stage aborts the
render rather than degrading the output. The CLI exits non-zero with
`ok:false`, the workflow stops before the upload node, and Telegram carries the
message. Nothing partial ever reaches YouTube.

Imagery and music keep their own fallbacks and do not stop the run — a scene on
the drawn background is still a publishable video.

No automatic retry. Script and render failures here are deterministic — a bad
model name, a missing key, an unaccepted speech model — and running them again
produces the same error a minute later. The notification is the retry.

## Testing

| What | Where |
|---|---|
| `--niche-file` parsing, and the conflict with `--niche` | `src/services/cli-args.test.ts` |
| Result object construction and the three `youtube` fallbacks | `src/services/result.test.ts` (new) |
| The avoid-list rendering into the prompt; multi-line niche block | `src/services/script-schema.test.ts` |
| History append and the 40-entry window | `src/services/history.test.ts` (new) |

End to end, offline and without a key:

```bash
npm run start -- --payload scripts/example-payload.json --no-audio --json
```

stdout must parse as JSON on its own, and stderr must hold the render logs.

The n8n workflow itself is verified by running it once by hand against a video
already in `out/`.
