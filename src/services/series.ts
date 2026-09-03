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
