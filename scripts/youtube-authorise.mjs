// Gets the long-lived YouTube refresh token that CI publishes with.
//
// Run once, on a machine with a browser:
//
//     node scripts/youtube-authorise.mjs --client-id <id> --client-secret <secret>
//
// Before it will work, the OAuth client needs this exact redirect URI added in
// Google Cloud Console under APIs & Services > Credentials:
//
//     http://localhost:8765/
//
// BEWARE the publishing status of the OAuth consent screen. While the app is in
// "Testing", Google expires every refresh token after seven days, which makes a
// nightly job die each week for no visible reason. The consent screen has to be
// "In production" for the token to last. Publishing it does not require
// verification while the only scopes are these and the only user is you.

import http from "node:http";
import { spawn } from "node:child_process";

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/`;

// youtube.upload alone cannot set a thumbnail; youtube covers both, and nothing
// here needs the broader youtubepartner or force-ssl that n8n's node requests.
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];

  return value && !value.startsWith("--") ? value : undefined;
}

const clientId = flag("client-id") ?? process.env.YOUTUBE_CLIENT_ID;
const clientSecret = flag("client-secret") ?? process.env.YOUTUBE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Usage: node scripts/youtube-authorise.mjs --client-id <id> --client-secret <secret>\n" +
      "Both come from the OAuth 2.0 Client ID in Google Cloud Console.",
  );
  process.exit(1);
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

    // start is a cmd builtin, hence the shell; the empty string is the window
    // title cmd would otherwise take the URL for.
    spawn("cmd", ["/c", "start", "", consentUrl], { stdio: "ignore", detached: true }).unref();
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

console.log("\nRefresh token:\n");
console.log(refreshToken);
console.log("\nPut it in the repository's Actions secrets as YOUTUBE_REFRESH_TOKEN.");
console.log("Treat it as a password: it grants upload access to the channel until revoked.");
