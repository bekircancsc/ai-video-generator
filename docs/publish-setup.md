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

## Two schedulers publish two videos

The cron is deliberately not in the workflow yet. The local n8n instance still
publishes daily at 09:00 from the same `history.json`, and adding a cron here
would put out two parts of the arc a day, each machine believing it was the
only one publishing.

Before adding a `schedule:` trigger, turn off the n8n side — deactivate the
workflow in the editor, or unregister the logon task with
`.\n8n\install-autostart.ps1 -Remove`.

The two also disagree about where the arc's position is written. A run here
commits `history.json` to `main`; a local n8n run writes it in the working
tree and nothing pushes it. Whichever one keeps publishing, `git pull` before
rendering locally, or the same episode goes out twice under two names.
