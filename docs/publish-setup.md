# Publishing from GitHub Actions

`.github/workflows/publish.yml` renders the next episode of an arc and uploads
it to YouTube as a private draft, on GitHub's machines rather than this one.
It exists because a machine that is off when the video is due publishes
nothing, and no local arrangement fixes that: n8n's schedule trigger registers
an ordinary cron and has no missed-run handling, so a slot that passes while
the laptop is asleep is simply gone.

The run does what the n8n workflow does, in one job: render with `--series`,
keep the video as an artifact whatever happens next, upload it, set the cover,
tell Telegram, and commit the `history.json` entry that moves the arc forward.

## The OAuth client

Publishing needs a refresh token for the channel's Google account, and a
refresh token needs an OAuth client to belong to.

In Google Cloud Console, under **APIs & Services**:

1. Enable the **YouTube Data API v3** for the project.
2. Create an OAuth client of type **Desktop app**. Not Web application — a
   Desktop client registers `http://localhost` and Google matches a loopback
   redirect on scheme, host and path while ignoring the port, so nothing has to
   be registered by hand and no port can go stale.
3. Set the OAuth consent screen to **In production**.

The third step is not cosmetic. While the consent screen is in **Testing**,
Google expires every refresh token after seven days, and a job that has run
fine all week starts failing on the eighth day with `invalid_grant` and no
other explanation. Publishing the screen does not require Google's verification
review while the only scopes are the two YouTube ones and the only user is you.

## The refresh token

Use the file behind the client's **Download JSON** button. The console masks
the secret and frequently will not copy it, and taking the file means the
secret is never selected, pasted or read aloud:

```powershell
node scripts/youtube-authorise.mjs --client-file "$env:USERPROFILE\Downloads\client_secret_....json" --out "$env:USERPROFILE\yt-token.txt"
```

It opens the consent screen, catches the redirect on port 8765, exchanges the
code, and writes the refresh token to the file named. It refuses to write
anywhere inside this repository, deliberately and crudely: a live credential
under a working tree is one `git add .` from being public.

Sign in as the account that owns the channel. If Google returns no refresh
token at all, the account has already granted this client and Google saw no
reason to mint a second one — revoke it at
https://myaccount.google.com/permissions and run the script again.

Delete the file once the secret below is saved.

## The secrets

Under **Settings → Secrets and variables → Actions** in this repository:

| Secret | Where it comes from |
| --- | --- |
| `LLM_API_KEY` | Groq. The same key the local `.env` uses; it writes nothing on a `--series` run but the CLI still resolves the provider. |
| `YOUTUBE_CLIENT_ID` | The downloaded client JSON. |
| `YOUTUBE_CLIENT_SECRET` | The same file. |
| `YOUTUBE_REFRESH_TOKEN` | What the script above printed. |
| `TELEGRAM_BOT_TOKEN` | @BotFather. |
| `TELEGRAM_CHAT_ID` | `https://api.telegram.org/bot<token>/getUpdates`, after messaging the bot once. |

A missing YouTube secret fails the publish step by name before anything is
uploaded. A missing Telegram one only costs the notification: the video is up
either way, and a failed message is not worth a red build over a live video.

## The first run

Run the workflow by hand from the Actions tab, with **dry-run** ticked. That
renders and uploads nothing, consumes no episode of the arc, and leaves the
mp4 and the cover as a downloadable artifact to look at. It proves the render
works on a machine with none of this one's cached audio, images or music.

Then run it again without dry-run. The video arrives private; the Telegram
message carries the link.

## One schedule, and it is this one

The workflow runs daily at **17:17 UTC**, which is 20:17 in Istanbul: GitHub
cron speaks UTC only and Turkey sits at UTC+3 the whole year, with no summer
change to chase. The odd minute is not decoration — scheduled runs are queued
best effort and the top of the hour is when every other repository asks too, so
a run booked at :00 is the one that waits. Expect the video a few minutes late
and sometimes half an hour; it arrives as a private draft, so the minute does
not matter.

A scheduled run carries **no inputs at all**. `inputs.series` is empty on a
`schedule` event, which is why the Render step falls back to a literal arc
instead of reading the input directly — without that the nightly run renders
`--series ""` and fails every night while the button beside it keeps working.
`inputs.dry-run` being empty is the behaviour wanted: a scheduled run publishes.

**The local n8n schedule was turned off on 2026-09-03, and must stay off.**
Both read the same `history.json`, so two live schedules put out two parts of
the arc a day. What was done: the `Publish a video` workflow set inactive in
`~/.n8n/database.sqlite`, and the logon task removed with the `-Remove` switch
of `n8n/install-autostart.ps1`. Reactivating it in the n8n editor is all it
takes to get the double publishing back.

The two also disagree about where the arc's position is written. A run here
commits `history.json` to `main`; a local n8n run writes it in the working tree
and nothing pushes it. `git pull` before rendering locally, or the same episode
goes out twice under two names.

## The video publishes itself

The upload is private, but not indefinitely. It carries a `publishAt`, and
YouTube turns it public on its own at **21:00 Istanbul** — 18:00 UTC, which is
what the code actually holds, Turkey having stopped changing its clocks in 2016.

The gap between the render landing around 20:17 and the video appearing at
21:00 is the whole point. Doing nothing publishes it; deleting it in Studio
inside that window is how you say no. There is no daily button to press, and
also no morning where something broken has been public since the evening
before.

`publishAt` only works on a private video, so `buildUploadMetadata` refuses the
combination rather than letting YouTube answer with an error about the privacy
status instead of the field that was set.

A time already past is rejected outright by the API, and a scheduled run is
queued best effort, so the publish time is never closer than
`MINIMUM_LEAD_MINUTES` from now: a run delayed past its own publish hour slips
to half an hour after it finishes rather than failing at the upload with the
render already paid for.
