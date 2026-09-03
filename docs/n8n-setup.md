# Running the pipeline from n8n

The workflow in `n8n/publish-video.workflow.json` produces one video a week and
uploads it to YouTube as a private draft. It generates nothing itself: it calls
the CLI once with `--json` and reads the result.

## Install n8n natively

n8n must run on **Node 24 or newer** on Windows. Before installing it, switch:

```powershell
nvm use 24.11.1
npm install -g n8n
n8n start
```

Then open http://localhost:5678.

Node 24 is not a preference, it is the difference between the workflow running
and not running. Every node that reads a file — **Read the video**, **Read the
cover** — goes through n8n's `createReadStream` helper, which stats the path,
opens a handle, stats the handle, and refuses the file if the two identities
disagree. It is a guard against the file being swapped between the two calls.
On Windows under Node 22 and 23 the two always disagree: `fs.stat()` reports
`dev` as `0` while `fileHandle.stat()` reports the real volume serial, so the
guard fires on every file, however still and readable it is. The node reports
`The file has changed and cannot be accessed.` and blames the video. Node 24
carries the libuv change that makes path-stat report the same `dev`, and the
guard passes.

Reproduce it in one command if it ever comes back:

```powershell
node -e "const {stat,open}=require('fs/promises');const {constants}=require('fs');(async()=>{const p='C:/n8n-data/video.mp4';const a=await stat(p);const f=await open(p,constants.O_RDONLY|constants.O_NOFOLLOW);const b=await f.stat();console.log(a.dev,b.dev,a.dev===b.dev);await f.close()})()"
```

Two different numbers means n8n cannot read that file. Note that nvm keeps
global packages per Node version, so n8n has to be installed again after the
switch — the copy under the old version is invisible to the new one.

Not in Docker. The Execute Command node has to see this repo, this Node
installation and ffmpeg, and inside a container it sees none of them. The cost
is that videos are only produced while this machine is on.

## Start it from the script, not by hand

```powershell
nvm use 24.11.1
.\n8n\start-n8n.ps1
```

`n8n start` on its own brings up an instance that looks healthy and cannot run
this workflow. Two settings have to be in the environment, and neither survives
a reboot on its own, so they live in `n8n/start-n8n.ps1`.

**`NODES_EXCLUDE`.** n8n excludes Execute Command by default — the shipped
value is `["n8n-nodes-base.executeCommand", "n8n-nodes-base.localFileTrigger"]`.
An excluded node is not disabled-but-visible: the editor never receives its
type, so the **Render** node draws as a grey `?`, the canvas turns read-only,
and nothing on screen says why. The override replaces the default list whole,
which is why the script names `localFileTrigger` again — that one should stay
excluded.

**`N8N_RESTRICT_FILE_ACCESS_TO`.** Set to `C:\n8n-data`, the directory `--stage`
copies into. Left unset the restriction is absent rather than relaxed, and n8n
will read anything the user can.

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

## The daily series run

The workflow publishes one part of *Please Do Not Press Four* a day. The Render
node calls

```
node run.mjs --series scripts/floor-four --json --stage C:\n8n-data
```

`--series` takes the arc's name, not a directory: it finds
`scripts/floor-four-part-1.json` and its siblings, sorts them by the number in
the filename, and renders the first one `history.json` has no record of. A
directory would have swept up `example-payload.json`, which sits beside them.

That record is what moves the arc forward, so a `--series` run is written to
`history.json` where a plain `--payload` run is not: the history exists to stop
the model repeating itself, and a hand-written script was never its choice, but
the arc needs to know where it got to. The entry's topic reads
`series:floor-four-part-2.json`. Ordering by the filename and not by position
means a gap in the numbering still goes out in the author's intended order, and
a part whose render failed is picked up again the next day rather than skipped.

**The arc is finite.** Five parts, one a day, and on the sixth day the run fails
with `Every episode of scripts/floor-four has been published (5 of 5)`. That is
the design, not a fault: the schedule keeps firing and the failure is the
reminder to write the next part. Nothing is uploaded on a failed run, because
the Render node is the first step.

`scripts/floor-four-publishing.md` carries the series' own release schedule,
descriptions and pinned comments, and this workflow does none of that. It
renders and uploads the private draft; the listing still comes from the pack by
hand.

To go back to one-off videos from the niche instead, the command is
`node run.mjs --niche-file niches/floor-four.md --scenes 6 --json --stage C:\n8n-data`.
Those runs generate their own subject and are given the last 40 published titles
as a do-not-repeat list.
