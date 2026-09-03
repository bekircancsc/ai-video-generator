// Gets the long-lived YouTube refresh token that CI publishes with.
//
// Run once, on a machine with a browser. Easiest with the file behind the
// OAuth client's "Download JSON" button, since the console masks the secret
// and will often not copy it:
//
//     node scripts/youtube-authorise.mjs --client-file ~/Downloads/client_secret_....json
//
// --client-id and --client-secret work too, and --out <file> writes the token
// somewhere outside the repository rather than printing it to be selected.
//
// Before it will work, the OAuth client needs this exact redirect URI added in
// Google Cloud Console (not needed for a Desktop app client, which allows any
// loopback port on its own):
//
//     http://localhost:8765
//
// BEWARE the publishing status of the OAuth consent screen. While the app is in
// "Testing", Google expires every refresh token after seven days, which makes a
// nightly job die each week for no visible reason. The consent screen has to be
// "In production" for the token to last. Publishing it does not require
// verification while the only scopes are these and the only user is you.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 8765;

// No trailing slash, which is the bare `http://localhost` a Desktop app client
// registers; Google matches a loopback redirect on scheme, host and path and
// ignores the port. Sent in this form because it is the registered one, not
// because the slash was ever the problem: the redirect_uri_mismatch that
// prompted the change came from openInBrowser below, not from here.
const REDIRECT_URI = `http://localhost:${PORT}`;

// youtube.upload alone cannot set a thumbnail; youtube covers both, and nothing
// here needs the broader youtubepartner or force-ssl that n8n's node requests.
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

/**
 * Opens a URL in the default browser without letting a shell read it first.
 *
 * Not `cmd /c start`: Node quotes an argument only when it contains a space, so
 * the consent URL reaches cmd.exe unquoted and cmd cuts it at the first `&`.
 * The browser then asks Google to authorise with a client_id and nothing else —
 * no redirect_uri, no scope — and Google answers redirect_uri_mismatch, which
 * sends you to inspect a redirect URI that was never sent. rundll32 takes the
 * URL as one argv entry and no shell ever parses it.
 */
function openInBrowser(url) {
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];

  return value && !value.startsWith("--") ? value : undefined;
}

/**
 * Reads the JSON Google hands out from the OAuth client page.
 *
 * The console masks the client secret and does not always offer a copy button,
 * so "Download JSON" is often the only way to get at it. Taking the file
 * directly means the secret never has to be selected, pasted, or read aloud.
 * The shape has the fields under `web` or `installed` depending on the client
 * type, and neither is worth making the caller care about.
 */
function fromClientFile(file) {
  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Could not read ${file}: ${error.message}`);
    process.exit(1);
  }

  const block = parsed.web ?? parsed.installed ?? parsed;

  if (!block.client_id || !block.client_secret) {
    console.error(`${file} carries no client_id and client_secret. Is it the OAuth client JSON?`);
    process.exit(1);
  }

  return { clientId: block.client_id, clientSecret: block.client_secret };
}

const clientFile = flag("client-file");
const fromFile = clientFile ? fromClientFile(clientFile) : undefined;

const clientId = flag("client-id") ?? fromFile?.clientId ?? process.env.YOUTUBE_CLIENT_ID;
const clientSecret = flag("client-secret") ?? fromFile?.clientSecret ?? process.env.YOUTUBE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Usage:\n" +
      "  node scripts/youtube-authorise.mjs --client-file <downloaded.json>\n" +
      "  node scripts/youtube-authorise.mjs --client-id <id> --client-secret <secret>\n\n" +
      "The JSON is the 'Download JSON' button on the OAuth client in Google Cloud Console,\n" +
      "which is the easier route: the console masks the secret and often will not copy it.",
  );
  process.exit(1);
}

if (fromFile) {
  console.log(`Read the client from ${clientFile}`);
}

const consentUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline is what asks for a refresh token at all; consent forces Google to
    // issue a new one even if this account has already approved the app, which
    // it silently declines to do otherwise.
    access_type: "offline",
    prompt: "consent",
  });

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, REDIRECT_URI);
    const received = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(received ? "Authorised. You can close this tab." : `Authorisation failed: ${error}`);

    server.close();

    if (received) resolve(received);
    else reject(new Error(`Google returned no code: ${error ?? "unknown error"}`));
  });

  server.listen(PORT, () => {
    console.log(`Listening on ${REDIRECT_URI}`);
    console.log("Opening the consent screen. If nothing happens, paste this into a browser:\n");
    console.log(`${consentUrl}\n`);

    openInBrowser(consentUrl);
  });
});

const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  }),
});

const body = await response.text();

if (!response.ok) {
  console.error(`Token exchange failed (${response.status}): ${body}`);
  process.exit(1);
}

const { refresh_token: refreshToken } = JSON.parse(body);

if (!refreshToken) {
  console.error(
    "Google returned no refresh token. That happens when the account has already granted this\n" +
      "app and Google saw no reason to mint another. Revoke it at\n" +
      "https://myaccount.google.com/permissions and run this again.",
  );
  process.exit(1);
}

const out = flag("out");

if (out) {
  // Refuse to drop a live credential where git could pick it up. Crude on
  // purpose: anywhere under the repository is the wrong place for it.
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const target = path.resolve(process.cwd(), out);

  if (!path.relative(repoRoot, target).startsWith("..")) {
    console.error(`\nRefusing to write a credential inside the repository: ${target}`);
    console.error("Choose a path outside it, or drop --out and copy from the screen.");
    process.exit(1);
  }

  fs.writeFileSync(target, `${refreshToken}\n`, "utf8");
  console.log(`\nRefresh token written to ${target}`);
} else {
  console.log("\nRefresh token:\n");
  console.log(refreshToken);
}

console.log("\nPut it in the repository's Actions secrets as YOUTUBE_REFRESH_TOKEN.");
console.log("Treat it as a password: it grants upload access to the channel until revoked.");
console.log("Delete any file you wrote it to once the secret is saved.");
