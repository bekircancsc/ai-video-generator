import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VideoPayload } from "../types/video";
import { draftPath, saveDraft } from "./draft";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "draft-"));
}

const script = {
  title: "I Pressed Four",
  fps: 30,
  aspectRatio: "9:16",
  scenes: [
    {
      id: "scene-1",
      text: "The panel had a fourth button",
      subtext: "The building has three floors.",
      narration: "The panel had a fourth button, and the building has three floors.",
      durationInFrames: 100,
      themeColor: "#a8903c",
      keywords: ["lift", "panel"],
    },
  ],
} as unknown as VideoPayload;

test("the draft is dated and named after the slug", () => {
  const written = draftPath("/root", "i-pressed-four", new Date("2026-09-03T22:10:00Z"));

  assert.equal(written, path.join("/root", "out", "drafts", "2026-09-03-i-pressed-four.json"));
});

test("the draft lands under out/, which is gitignored along with the renders", () => {
  assert.match(draftPath("/root", "s"), new RegExp(`${path.sep === "\\" ? "\\\\" : "/"}out\\${path.sep}drafts\\${path.sep}`));
});

test("a saved draft reads back as the script that was rendered", async () => {
  const root = await tempRoot();

  const written = await saveDraft(root, "i-pressed-four", script);

  assert.ok(written);
  assert.deepEqual(JSON.parse(await fs.readFile(written, "utf8")), script);
});

test("the draft is written even though its directory does not exist yet", async () => {
  const root = await tempRoot();

  const written = await saveDraft(root, "s", script);

  assert.ok(written);
  assert.ok(await fs.stat(written));
});

test("saving the same slug twice in a day replaces the draft rather than piling up", async () => {
  const root = await tempRoot();
  const date = new Date("2026-09-03T00:00:00Z");

  await saveDraft(root, "s", script, date);
  await saveDraft(root, "s", { ...script, title: "Second attempt" } as VideoPayload, date);

  const drafts = await fs.readdir(path.join(root, "out", "drafts"));

  assert.equal(drafts.length, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, "out", "drafts", drafts[0]), "utf8")).title, "Second attempt");
});

test("a draft that cannot be written loses the safety net, not the render", async () => {
  const root = await tempRoot();
  // out/ is a file here, so the drafts directory underneath it cannot be made.
  await fs.mkdir(path.join(root, "out"), { recursive: false }).catch(() => {});
  await fs.rm(path.join(root, "out"), { recursive: true, force: true });
  await fs.writeFile(path.join(root, "out"), "not a directory", "utf8");

  assert.equal(await saveDraft(root, "s", script), undefined);
});
