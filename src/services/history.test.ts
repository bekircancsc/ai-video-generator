import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HISTORY_LIMIT, appendHistory, historyPath, readHistory, recentTitles } from "./history";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "history-"));
}

test("a missing history file reads as an empty list", async () => {
  const root = await tempRoot();

  assert.deepEqual(await readHistory(root), []);
});

test("a corrupt history file reads as an empty list rather than failing a render", async () => {
  const root = await tempRoot();
  await fs.writeFile(historyPath(root), "{ not json", "utf8");

  assert.deepEqual(await readHistory(root), []);
});

test("a history file holding something other than a list reads as empty", async () => {
  const root = await tempRoot();
  await fs.writeFile(historyPath(root), '{"date":"2026-09-01"}', "utf8");

  assert.deepEqual(await readHistory(root), []);
});

test("append writes an entry that reads back", async () => {
  const root = await tempRoot();
  await appendHistory(root, {
    date: "2026-09-01",
    slug: "i-pressed-four",
    title: "I Pressed Four",
    topic: "office horror",
  });

  const entries = await readHistory(root);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "I Pressed Four");
});

test("append keeps earlier entries and adds to the end", async () => {
  const root = await tempRoot();
  await appendHistory(root, { date: "2026-09-01", slug: "a", title: "A", topic: "t" });
  await appendHistory(root, { date: "2026-09-02", slug: "b", title: "B", topic: "t" });

  assert.deepEqual(
    (await readHistory(root)).map((entry) => entry.slug),
    ["a", "b"],
  );
});

test("recent titles are the last entries, newest last", () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    date: "2026-09-01",
    slug: `s${i}`,
    title: `T${i}`,
    topic: "t",
  }));

  const titles = recentTitles(entries);

  assert.equal(titles.length, HISTORY_LIMIT);
  assert.equal(titles[0], "T10");
  assert.equal(titles[titles.length - 1], "T49");
});

test("recent titles of a short history is the whole history", () => {
  assert.deepEqual(recentTitles([{ date: "d", slug: "s", title: "Only One", topic: "t" }]), ["Only One"]);
});
