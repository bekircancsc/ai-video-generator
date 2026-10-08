import { loadPayloadFile } from "./script-provider";
import type { QueuedArc } from "./series";
import { describeYouTubeError, VIDEO_LANGUAGE } from "./youtube";

const API_URL = "https://www.googleapis.com/youtube/v3";

/**
 * The arc a `--series` render belongs to, as its playlist needs it.
 *
 * `partTitles` is every written part in arc order, published or not: the
 * playlist is rebuilt from the channel's uploads by title, so a part that has
 * gone out without being added (every part before this feature, or a night the
 * playlist call failed) is picked up on the next run instead of being lost.
 */
export type SeriesPlaylist = {
  title: string;
  partTitles: string[];
};

/** "camera-six" -> "Camera Six", for an arc whose first part names no title. */
export function titleFromPrefix(prefix: string): string {
  const name = prefix.split(/[\\/]/).pop() ?? prefix;

  return name
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** An arc's playlist title and every written part's title, read from its payloads. */
export async function arcPlaylist(arc: QueuedArc): Promise<SeriesPlaylist> {
  const parts = await Promise.all(arc.episodes.map((part) => loadPayloadFile(part.file)));

  return {
    title: parts[0]?.seriesTitle || titleFromPrefix(arc.prefix),
    partTitles: parts.map((part) => part.youtube?.title || part.title),
  };
}

/**
 * Which videos to append, in the order to append them.
 *
 * Pure, so the ordering can be tested without the API. Parts go in arc order,
 * skipping any already in the playlist and any not uploaded yet. A title the
 * channel has used twice resolves to whichever id `uploads` holds for it, which
 * the caller fills newest first.
 */
export function plannedAdditions(
  partTitles: string[],
  uploads: Map<string, string>,
  existing: Set<string>,
): string[] {
  const additions: string[] = [];

  for (const title of partTitles) {
    const videoId = uploads.get(title);

    if (videoId && !existing.has(videoId) && !additions.includes(videoId)) {
      additions.push(videoId);
    }
  }

  return additions;
}

type Page<T> = { items?: T[]; nextPageToken?: string };

async function call<T>(token: string, method: "GET" | "POST", resource: string, params: Record<string, string>, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}/${resource}?${new URLSearchParams(params)}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw describeYouTubeError(response.status, await response.text());
  }

  return (await response.json()) as T;
}

async function listAll<T>(token: string, resource: string, params: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;

  do {
    const page = await call<Page<T>>(token, "GET", resource, {
      ...params,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });

    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return items;
}

type PlaylistItem = { snippet?: { title?: string; resourceId?: { videoId?: string } } };

async function findOrCreatePlaylist(token: string, title: string): Promise<{ id: string; created: boolean }> {
  const mine = await listAll<{ id: string; snippet?: { title?: string } }>(token, "playlists", {
    part: "snippet",
    mine: "true",
  });
  const found = mine.find((playlist) => playlist.snippet?.title === title);

  if (found) {
    return { id: found.id, created: false };
  }

  // Public from the start: a scheduled part inside it stays hidden until its
  // own publishAt, so the playlist never shows a video early.
  const created = await call<{ id: string }>(token, "POST", "playlists", { part: "snippet,status" }, {
    snippet: { title, description: `${title}. Every part, in order.`, defaultLanguage: VIDEO_LANGUAGE },
    status: { privacyStatus: "public" },
  });

  return { id: created.id, created: true };
}

/** The channel's uploads as title -> id, newest first so a reused title means the latest video. */
async function uploadsByTitle(token: string): Promise<Map<string, string>> {
  const channels = await call<{ items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }>(
    token,
    "GET",
    "channels",
    { part: "contentDetails", mine: "true" },
  );
  const uploads = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!uploads) {
    throw new Error("The channel has no uploads playlist to read.");
  }

  const byTitle = new Map<string, string>();

  for (const item of await listAll<PlaylistItem>(token, "playlistItems", { part: "snippet", playlistId: uploads })) {
    const title = item.snippet?.title;
    const videoId = item.snippet?.resourceId?.videoId;

    if (title && videoId && !byTitle.has(title)) {
      byTitle.set(title, videoId);
    }
  }

  return byTitle;
}

/**
 * Makes the arc's playlist hold every part uploaded so far, in order.
 *
 * `justUploaded` is passed in rather than looked up, because a video uploaded
 * seconds ago is not reliably in the uploads listing yet. A sync with nothing
 * just uploaded, for an arc that has finished, leaves it out.
 */
export async function syncSeriesPlaylist({
  token,
  series,
  justUploaded,
}: {
  token: string;
  series: SeriesPlaylist;
  justUploaded?: { title: string; videoId: string };
}): Promise<{ playlistId: string; added: number; created: boolean }> {
  const { id: playlistId, created } = await findOrCreatePlaylist(token, series.title);
  const uploads = await uploadsByTitle(token);

  if (justUploaded) {
    uploads.set(justUploaded.title, justUploaded.videoId);
  }

  const existing = created
    ? new Set<string>()
    : new Set(
        (await listAll<PlaylistItem>(token, "playlistItems", { part: "snippet", playlistId }))
          .map((item) => item.snippet?.resourceId?.videoId)
          .filter((id): id is string => Boolean(id)),
      );

  const additions = plannedAdditions(series.partTitles, uploads, existing);

  // One at a time: concurrent inserts into one playlist land in arbitrary order.
  for (const videoId of additions) {
    await call(token, "POST", "playlistItems", { part: "snippet" }, {
      snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
    });
  }

  return { playlistId, added: additions.length, created };
}
