import fs from "node:fs/promises";
import path from "node:path";

/** One published video, as the next run needs to know about it. */
export type HistoryEntry = {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  slug: string;
  title: string;
  /** The topic or niche the run was given. Empty for a rendered payload file. */
  topic: string;
};

/**
 * How many past titles go into the next prompt.
 *
 * Enough that a fixed niche has to keep finding new ground, short enough that
 * the list does not crowd out the brief itself.
 */
export const HISTORY_LIMIT = 40;

export function historyPath(rootDir: string): string {
  return path.join(rootDir, "history.json");
}

/**
 * Reads the history, treating every failure as "no history".
 *
 * A missing file is the normal first run. A corrupt one is a file someone
 * hand-edited, and refusing to render over it would trade a whole video for a
 * bad line of JSON — the cost of an empty list is one possible repeat.
 */
export async function readHistory(rootDir: string): Promise<HistoryEntry[]> {
  let raw: string;

  try {
    raw = await fs.readFile(historyPath(rootDir), "utf8");
  } catch {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    console.warn("[history] history.json is not valid JSON, continuing without it");
    return [];
  }
}

/** Appends one entry. The whole file is rewritten: it holds tens of lines, not thousands. */
export async function appendHistory(rootDir: string, entry: HistoryEntry): Promise<void> {
  const entries = await readHistory(rootDir);
  entries.push(entry);

  await fs.writeFile(historyPath(rootDir), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

/** The titles the next prompt is told not to repeat, oldest first. */
export function recentTitles(entries: HistoryEntry[], limit = HISTORY_LIMIT): string[] {
  return entries.slice(-limit).map((entry) => entry.title);
}
