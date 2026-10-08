import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHistory } from "../services/history";
import { arcPlaylist, syncSeriesPlaylist } from "../services/playlist";
import { loadArcs, publishedEpisodes } from "../services/series";
import { accessToken } from "../services/youtube";

/**
 * Brings the playlists of the named arcs up to date without uploading anything.
 *
 * The nightly publish fills the playlist of the arc it is publishing, so an arc
 * that finished before playlists existed never gets one that way. This is the
 * one-off for those, and it is safe to repeat: a part already in its playlist
 * is not added twice.
 *
 *   node --import tsx src/pipeline/sync-playlists.ts --series scripts/floor-four [--series ...]
 */

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..", "..");
const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

export function seriesArgs(argv: string[]): string[] {
  const prefixes: string[] = [];

  argv.forEach((arg, index) => {
    if (arg === "--series" && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      prefixes.push(argv[index + 1]);
    }
  });

  return prefixes;
}

if (isDirectRun) {
  const run = async () => {
    const prefixes = seriesArgs(process.argv.slice(2));

    if (prefixes.length === 0) {
      throw new Error("Usage: node --import tsx src/pipeline/sync-playlists.ts --series <prefix> [--series <prefix> ...]");
    }

    const published = publishedEpisodes(await readHistory(rootDir));
    const token = await accessToken();

    for (const arc of await loadArcs(prefixes, rootDir)) {
      // An arc with nothing out yet would get an empty public playlist.
      if (!arc.episodes.some((episode) => published.has(path.basename(episode.file)))) {
        console.log(`${arc.prefix}: nothing published yet, skipped.`);
        continue;
      }

      const series = await arcPlaylist(arc);
      const { added, created } = await syncSeriesPlaylist({ token, series });
      console.log(`Playlist "${series.title}": ${created ? "created, " : ""}${added} added.`);
    }
  };

  run().catch((error) => {
    console.error("Playlist sync failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
