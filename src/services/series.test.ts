import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HistoryEntry } from "./history";
import { listEpisodes, nextEpisode, publishedEpisodes, seriesTopic } from "./series";

async function arcOf(...names: string[]) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "series-"));

  for (const name of names) {
    await fs.writeFile(path.join(directory, name), "{}", "utf8");
  }

  return directory;
}

function entry(topic: string): HistoryEntry {
  return { date: "2026-09-03", slug: "s", title: "T", topic };
}

test("episodes come back in numeric order, not alphabetical", async () => {
  const directory = await arcOf("arc-part-1.json", "arc-part-2.json", "arc-part-10.json");

  const episodes = await listEpisodes(path.join(directory, "arc"));

  assert.deepEqual(
    episodes.map((episode) => episode.number),
    [1, 2, 10],
  );
});

test("only the named arc is picked up, not its neighbours", async () => {
  const directory = await arcOf(
    "arc-part-1.json",
    "example-payload.json",
    "other-part-1.json",
    "arc-part-2.txt",
    "arc-notes.md",
  );

  const episodes = await listEpisodes(path.join(directory, "arc"));

  assert.deepEqual(
    episodes.map((episode) => path.basename(episode.file)),
    ["arc-part-1.json"],
  );
});

test("an arc whose numbering has a gap keeps the author's order", async () => {
  const directory = await arcOf("arc-part-1.json", "arc-part-4.json");

  const episodes = await listEpisodes(path.join(directory, "arc"));

  assert.deepEqual(
    episodes.map((episode) => episode.number),
    [1, 4],
  );
});

test("a missing series directory says so rather than reading as an empty arc", async () => {
  await assert.rejects(
    () => listEpisodes(path.join(os.tmpdir(), "no-such-directory-here", "arc")),
    /Could not read the series directory/,
  );
});

test("the first run of an arc takes part one", async () => {
  const directory = await arcOf("arc-part-1.json", "arc-part-2.json");
  const episodes = await listEpisodes(path.join(directory, "arc"));

  assert.equal(nextEpisode(episodes, [])?.number, 1);
});

test("an episode recorded in the history is not rendered again", async () => {
  const directory = await arcOf("arc-part-1.json", "arc-part-2.json", "arc-part-3.json");
  const episodes = await listEpisodes(path.join(directory, "arc"));

  const history = [entry(seriesTopic("arc-part-1.json")), entry(seriesTopic("arc-part-2.json"))];

  assert.equal(nextEpisode(episodes, history)?.number, 3);
});

test("a finished arc has no next episode", async () => {
  const directory = await arcOf("arc-part-1.json");
  const episodes = await listEpisodes(path.join(directory, "arc"));

  assert.equal(nextEpisode(episodes, [entry(seriesTopic("arc-part-1.json"))]), undefined);
});

test("a gap in the history is filled before moving on", async () => {
  const directory = await arcOf("arc-part-1.json", "arc-part-2.json", "arc-part-3.json");
  const episodes = await listEpisodes(path.join(directory, "arc"));

  // Part two failed to render the day it was due; the arc should not skip it.
  assert.equal(nextEpisode(episodes, [entry(seriesTopic("arc-part-1.json")), entry(seriesTopic("arc-part-3.json"))])?.number, 2);
});

test("a generated run's history entry is never mistaken for an episode", () => {
  assert.deepEqual(publishedEpisodes([entry("niches/floor-four.md"), entry("office horror"), entry("")]), new Set());
});

test("the recorded topic ignores the directory the arc sits in", () => {
  assert.equal(seriesTopic(path.join("scripts", "floor-four-part-2.json")), "series:floor-four-part-2.json");
});
