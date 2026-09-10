import fs from "node:fs/promises";
import path from "node:path";
import type { HistoryEntry } from "./history";

/**
 * One numbered instalment of an arc.
 *
 * The number is the one in the filename, not the position in the list: an arc
 * with a gap in it still goes out in the author's intended order.
 */
export type Episode = {
  /** Path as given to `--payload`, relative to the series prefix's directory. */
  file: string;
  number: number;
};

/**
 * How a series render records itself, so tomorrow's run knows to move on.
 *
 * The prefix keeps these apart from a generated run's topic, which is a niche
 * file path or a free-text subject, and the basename rather than the full path
 * means moving the arc into another directory does not republish it.
 */
export function seriesTopic(episodeFile: string): string {
  return `series:${path.basename(episodeFile)}`;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The instalments of one arc, in the order they should go out.
 *
 * `seriesPrefix` names the arc, not a directory: `scripts/floor-four` finds
 * `scripts/floor-four-part-1.json` and its siblings. A directory would have
 * swept up `example-payload.json` too, and the arc already lives alongside
 * unrelated payloads.
 */
export async function listEpisodes(seriesPrefix: string): Promise<Episode[]> {
  const directory = path.dirname(seriesPrefix);
  const name = path.basename(seriesPrefix);
  const pattern = new RegExp(`^${escapeForRegExp(name)}-part-(\\d+)\\.json$`);

  let entries: string[];

  try {
    entries = await fs.readdir(directory);
  } catch {
    throw new Error(`Could not read the series directory: ${directory}`);
  }

  const episodes = entries
    .map((entry) => {
      const match = pattern.exec(entry);

      return match ? { file: path.join(directory, entry), number: Number(match[1]) } : undefined;
    })
    .filter((episode): episode is Episode => episode !== undefined);

  // Numeric, so part 10 follows part 9 rather than part 1.
  return episodes.sort((a, b) => a.number - b.number);
}

/** The instalments already recorded in the history, by filename. */
export function publishedEpisodes(entries: HistoryEntry[]): Set<string> {
  return new Set(
    entries.filter((entry) => entry.topic.startsWith("series:")).map((entry) => entry.topic.slice("series:".length)),
  );
}

/**
 * The next instalment to render, or undefined when the arc has run out.
 *
 * Running out is a real state, not a failure of this function: an arc is
 * finite, and a daily schedule reaches the end of one. The caller decides what
 * to say about it.
 */
export function nextEpisode(episodes: Episode[], entries: HistoryEntry[]): Episode | undefined {
  const published = publishedEpisodes(entries);

  return episodes.find((episode) => !published.has(path.basename(episode.file)));
}

/** One arc in the queue, with whatever instalments exist for it today. */
export type QueuedArc = {
  /** The prefix as written on the command line, for messages the reader has to match up. */
  prefix: string;
  episodes: Episode[];
};

/**
 * The queued arcs, in the order they were named.
 *
 * An arc with no files yet is kept rather than rejected: naming tomorrow's arc
 * before writing it is the point of a queue. Dropping its first part into the
 * directory is then the whole of starting it, with nothing to change in the
 * schedule that runs this. An unreadable *directory* is still an error, because
 * that is a typo rather than an intention.
 */
export async function loadArcs(prefixes: string[], cwd = process.cwd()): Promise<QueuedArc[]> {
  const arcs: QueuedArc[] = [];

  for (const prefix of prefixes) {
    // Resolved for reading, kept as written for anything a person will read back.
    arcs.push({ prefix, episodes: await listEpisodes(path.resolve(cwd, prefix)) });
  }

  return arcs;
}

/** The next instalment across the whole queue, or undefined when every arc is spent. */
export function nextInQueue(
  arcs: QueuedArc[],
  entries: HistoryEntry[],
): { arc: QueuedArc; episode: Episode } | undefined {
  for (const arc of arcs) {
    const episode = nextEpisode(arc.episodes, entries);

    if (episode) {
      return { arc, episode };
    }
  }

  return undefined;
}

/**
 * How many instalments the whole queue still owes.
 *
 * Counted the same way `nextInQueue` picks, so the two can never disagree: an
 * episode already in the history is spent wherever it sits in its arc, and an
 * arc named but not yet written owes nothing. This is how far ahead the
 * schedule is written, which is the one number worth warning about — a finite
 * arc behind a daily cron runs out on a date nobody has in mind.
 */
export function unpublishedCount(arcs: QueuedArc[], entries: HistoryEntry[]): number {
  const published = publishedEpisodes(entries);

  return arcs.reduce(
    (total, arc) => total + arc.episodes.filter((episode) => !published.has(path.basename(episode.file))).length,
    0,
  );
}

/**
 * What to say when the queue has nothing left.
 *
 * Each arc is named with its own count, because "write the next part" and "the
 * arc you queued is still empty" are different jobs and the reader has to be
 * able to tell which one is waiting.
 */
export function exhaustedQueueMessage(arcs: QueuedArc[]): string {
  const lines = arcs.map((arc) => {
    const total = arc.episodes.length;

    return total === 0
      ? `  ${arc.prefix} — no parts written yet`
      : `  ${arc.prefix} — all ${total} published`;
  });

  return ["Every queued arc is spent:", ...lines, "Write the next part, or queue another arc."].join("\n");
}
