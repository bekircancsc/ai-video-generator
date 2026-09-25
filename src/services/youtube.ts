import "dotenv/config";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const THUMBNAIL_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

/** People & Blogs. The same category the n8n workflow used. */
export const DEFAULT_CATEGORY_ID = "24";

/**
 * The language every video is narrated in. Undeclared, YouTube guessed from
 * the uploader and seeded the feed with Turkish viewers, who swiped past
 * English narration and watched 22% of it on average.
 */
export const VIDEO_LANGUAGE = "en";

/** YouTube's own limits. Exceeding any of them fails the upload outright. */
export const TITLE_LIMIT = 100;
export const DESCRIPTION_LIMIT = 5000;
export const TAGS_LIMIT = 500;

/**
 * When a scheduled upload turns itself public: 18:00 UTC, which is 21:00 in
 * Istanbul the whole year — Turkey stopped changing its clocks in 2016, so no
 * summer-time arithmetic is needed and none is done.
 */
export const PUBLISH_HOUR_UTC = 18;

/**
 * How close to now a publish time is allowed to be.
 *
 * YouTube rejects a `publishAt` in the past outright, and a scheduled run is
 * queued best effort — it can land minutes or half an hour late. Without a
 * floor, a run delayed past its own publish hour would fail at the upload,
 * having already rendered.
 */
export const MINIMUM_LEAD_MINUTES = 30;

/**
 * The moment a video uploaded now should go public.
 *
 * Today's publish hour, unless that is too close or already gone, in which
 * case half an hour from now. The gap is the point: the video sits private
 * long enough to be deleted if the render came out wrong, and publishes itself
 * if nobody does anything.
 */
export function scheduledPublishTime(now: Date = new Date()): string {
  const target = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), PUBLISH_HOUR_UTC);
  const earliest = now.getTime() + MINIMUM_LEAD_MINUTES * 60_000;

  return new Date(Math.max(target, earliest)).toISOString();
}

export type YouTubeConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export type UploadMetadata = {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    defaultLanguage: string;
    defaultAudioLanguage: string;
  };
  status: {
    privacyStatus: string;
    selfDeclaredMadeForKids: boolean;
    containsSyntheticMedia: boolean;
    publishAt?: string;
  };
};

export function resolveYouTubeConfig(): YouTubeConfig {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  const missing = [
    clientId ? undefined : "YOUTUBE_CLIENT_ID",
    clientSecret ? undefined : "YOUTUBE_CLIENT_SECRET",
    refreshToken ? undefined : "YOUTUBE_REFRESH_TOKEN",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")}. Run scripts/youtube-authorise.mjs once to get a refresh token.`,
    );
  }

  return { clientId: clientId!, clientSecret: clientSecret!, refreshToken: refreshToken! };
}

/** Turns a failed YouTube response into a message that says what to do next. */
export function describeYouTubeError(status: number, body: string): Error {
  if (/invalid_grant/.test(body)) {
    return new Error(
      "The YouTube refresh token is no longer valid. Google expires them when the password " +
        "changes, when access is revoked, or after six months unused. Run " +
        "scripts/youtube-authorise.mjs again and replace YOUTUBE_REFRESH_TOKEN.",
    );
  }

  if (status === 401) {
    return new Error(`YouTube rejected the credentials (401): ${body.slice(0, 300)}`);
  }

  if (/youtubeSignupRequired/.test(body)) {
    return new Error("The Google account signed in has no YouTube channel.");
  }

  if (/uploadLimitExceeded/.test(body)) {
    return new Error("The channel has hit its daily upload limit. Nothing to fix; try tomorrow.");
  }

  if (status === 403 && /thumbnail/i.test(body)) {
    return new Error(
      "The channel is not allowed to set custom thumbnails. Verify it at youtube.com/verify.",
    );
  }

  if (status === 403) {
    return new Error(`YouTube refused the request (403): ${body.slice(0, 300)}`);
  }

  return new Error(`YouTube request failed (${status}): ${body.slice(0, 300)}`);
}

/**
 * Trims one field to a limit on a word boundary where it can.
 *
 * Cutting mid-word reads as a bug in the listing; cutting at a space reads as a
 * title. The fallback to a hard slice covers a single word longer than the
 * whole limit, which no boundary can help with.
 */
function clamp(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  const cut = value.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");

  return boundary > limit * 0.6 ? cut.slice(0, boundary) : cut;
}

/**
 * The upload body, with every field brought inside YouTube's limits.
 *
 * A model writing its own listing does not know them, and the API does not
 * negotiate: one character over and the whole upload is rejected after the
 * bytes have already gone up. Tags are dropped whole rather than truncated —
 * half a tag is not a tag — and the budget is the *combined* length, which is
 * the rule the API actually enforces.
 *
 * `containsSyntheticMedia` is not optional here. These videos are realistic
 * synthetic content and YouTube requires the disclosure; setting it at insert
 * time is also why no second call is needed, unlike through n8n's node, which
 * cannot set the field at all.
 */
export function buildUploadMetadata({
  title,
  description,
  tags,
  privacyStatus = "private",
  categoryId = DEFAULT_CATEGORY_ID,
  publishAt,
}: {
  title: string;
  description: string;
  tags: string[];
  privacyStatus?: string;
  categoryId?: string;
  publishAt?: string;
}): UploadMetadata {
  // YouTube only honours publishAt on a private video: on anything already
  // visible there is nothing left to schedule, and it answers with an error
  // about the privacy status rather than about the field you set.
  if (publishAt && privacyStatus !== "private") {
    throw new Error(`A publishAt needs privacyStatus "private", not "${privacyStatus}".`);
  }

  const kept: string[] = [];
  let used = 0;

  for (const tag of tags) {
    // Each tag past the first also costs the comma the API counts between them.
    const cost = tag.length + (kept.length > 0 ? 1 : 0);

    if (used + cost > TAGS_LIMIT) {
      break;
    }

    kept.push(tag);
    used += cost;
  }

  return {
    snippet: {
      title: clamp(title, TITLE_LIMIT),
      description: clamp(description, DESCRIPTION_LIMIT),
      tags: kept,
      categoryId,
      defaultLanguage: VIDEO_LANGUAGE,
      defaultAudioLanguage: VIDEO_LANGUAGE,
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      ...(publishAt ? { publishAt } : {}),
    },
  };
}

/** Exchanges the long-lived refresh token for an access token good for about an hour. */
export async function accessToken(config = resolveYouTubeConfig()): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    throw describeYouTubeError(response.status, body);
  }

  const token = (JSON.parse(body) as { access_token?: string }).access_token;

  if (!token) {
    throw new Error("Google returned no access token for the refresh token.");
  }

  return token;
}

/**
 * Uploads the video and returns its id.
 *
 * Resumable rather than a single multipart POST, because that is the only
 * protocol YouTube documents for video bytes. The file goes up in one PUT
 * regardless: these are tens of megabytes, and chunking buys nothing but a
 * loop that can get its offsets wrong.
 */
export async function uploadVideo({
  token,
  video,
  metadata,
}: {
  token: string;
  video: Buffer;
  metadata: UploadMetadata;
}): Promise<string> {
  const start = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-upload-content-length": String(video.length),
      "x-upload-content-type": "video/mp4",
    },
    body: JSON.stringify(metadata),
  });

  if (!start.ok) {
    throw describeYouTubeError(start.status, await start.text());
  }

  const session = start.headers.get("location");

  if (!session) {
    throw new Error("YouTube opened no upload session: the response carried no Location header.");
  }

  const upload = await fetch(session, {
    method: "PUT",
    headers: { "content-type": "video/mp4", "content-length": String(video.length) },
    body: new Uint8Array(video),
  });

  const body = await upload.text();

  if (!upload.ok) {
    throw describeYouTubeError(upload.status, body);
  }

  const id = (JSON.parse(body) as { id?: string }).id;

  if (!id) {
    throw new Error("YouTube accepted the upload but returned no video id.");
  }

  return id;
}

/** Sets the custom thumbnail. Requires a phone-verified channel. */
export async function setThumbnail({
  token,
  videoId,
  cover,
  mimeType = "image/jpeg",
}: {
  token: string;
  videoId: string;
  cover: Buffer;
  mimeType?: string;
}): Promise<void> {
  const response = await fetch(`${THUMBNAIL_URL}?videoId=${encodeURIComponent(videoId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": mimeType,
      "content-length": String(cover.length),
    },
    body: new Uint8Array(cover),
  });

  if (!response.ok) {
    throw describeYouTubeError(response.status, await response.text());
  }
}

/** Where a finished upload can be watched. */
export function watchUrl(videoId: string): string {
  return `https://youtube.com/watch?v=${videoId}`;
}
