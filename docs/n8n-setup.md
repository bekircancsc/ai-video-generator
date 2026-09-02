# Running the pipeline from n8n

The workflow in `n8n/publish-video.workflow.json` produces one video a week and
uploads it to YouTube as a private draft. It generates nothing itself: it calls
the CLI once with `--json` and reads the result.

## Install n8n natively

```powershell
npm install -g n8n
n8n start
```

Then open http://localhost:5678.

Not in Docker. The Execute Command node has to see this repo, this Node
installation and ffmpeg, and inside a container it sees none of them. The cost
is that videos are only produced while this machine is on.

## Import and wire

1. **Workflows → Import from file** → `n8n/publish-video.workflow.json`.
2. Attach the credentials below.

Give the Render node a generous timeout. A six-scene video takes well over ten
minutes on a cold cache — script, six voiceovers, six transcriptions, six
images, a music bed, the render itself, then loudness and the cover.

### The repo path, and where the files land

The Execute Command node has no working-directory setting, so the `cd` is part
of the command. It uses the 8.3 short path,
`C:\Users\bekircan\OneDrive\MASAST~1\AI-VID~1`, and that is not a stylistic
choice: cmd.exe cannot read the accented characters in `Masaüstü` and fails the
`cd` outright with a syntax error. Get the short path for any directory with:

```powershell
(New-Object -ComObject Scripting.FileSystemObject).GetFolder("<path>").ShortPath
```

n8n restricts its file nodes to the directories in `N8N_RESTRICT_FILE_ACCESS_TO`
— here `C:\n8n-data` — so the render cannot be read from `out/` at all. That is
what `--stage C:\n8n-data` is for: it drops a copy of the video and the cover there
as `video.mp4` and `cover.jpg`, and the two file nodes point at those names as
plain text.

The fixed names are the point. Building `C:\n8n-data\<slug>.mp4` in the node would
need an expression, and an expression that silently fails to resolve — a field
left in Fixed mode, a node run on its own with no input — passes its own source
text through as a filename. A constant path cannot do that. The copies are
overwritten every run; nothing reads them after the upload.

### Read/Write Files from Disk, not Read Binary File

The two file nodes are `Read/Write Files from Disk`. The older `Read Binary
File` node is deprecated and on current n8n (checked against 2.8.4) it fails
with `The file has changed and cannot be accessed` even when the file is
complete, readable and nothing is holding it. Both nodes also have Retry On
Fail set to three tries five seconds apart, because a virus scanner can hold a
freshly written file for a moment.

### Call node, not npm

The command is `node run.mjs … --json`, not `npm run start -- … --json`.

`npm run` prints its own two-line banner to stdout before the script starts, and
that lands in front of the JSON where nothing in this repo can suppress it. The
pipeline's own logs are already on stderr; npm's are not ours to move.
`npm run --silent start` also works if you prefer the npm form.

## Credentials

Both live in n8n, not in `.env`. The repo never reads them.

**YouTube OAuth2.** Create a Google Cloud project, enable the YouTube Data API
v3, create an OAuth client of type "Web application", and add n8n's callback URL
as an authorised redirect URI. Attach the credential to both the
**Upload to YouTube** node and the **Set the cover** node.

An upload costs 1600 units against a default 10,000/day, so roughly six videos a
day. A weekly run is nowhere near it.

**Telegram.** Create a bot with @BotFather, take the token, and message the bot
once so it can reply to you. Set the chat id on the **Tell me** node.

## The contract

stdout carries one JSON object and nothing else. stderr carries every log.

```json
{"ok":true,"mp4":"out/x.mp4","cover":"out/x.jpg","slug":"x",
 "title":"…","description":"…","tags":["…"],"durationSeconds":47.2,
 "stagedMp4":"C:\\n8n-data\\video.mp4","stagedCover":"C:\\n8n-data\\cover.jpg"}
```

On failure, stdout carries `{"ok":false,"error":"…"}` and the process exits 1.
`cover` is absent when `--no-cover` was passed or the cover stage fell back.
Paths are repo-relative with forward slashes. The two `staged` fields appear
only when `--stage <dir>` was passed, and are absolute.

## What it does on failure

A failing production stage aborts the render, the CLI exits non-zero, and the
Code node throws before anything is uploaded. Nothing partial ever reaches
YouTube. Add an **Error Trigger** workflow with a Telegram node to be told when
that happens.

There is no automatic retry. Script and render failures here are deterministic —
a bad model name, a missing key, an unaccepted speech model — and running them
again produces the same error a minute later.

## Rendering a hand-written series instead

The *Please Do Not Press Four* series is rendered from payload files, not from a
niche, and `scripts/floor-four-publishing.md` carries its own release schedule,
descriptions and pinned comments. The same workflow publishes those — change the
Render node's command to

```
node run.mjs --payload scripts/floor-four-part-3.json --json --stage C:\n8n-data
```

— but the publishing pack asks for scheduled releases and pinned comments, and
this workflow does neither. For that series the workflow is a way to render and
upload the draft; the listing still comes from the pack by hand.

Payload runs are not written to `history.json`. That list exists to stop the
model repeating itself, and a hand-written script was never its choice.
