import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { failureMessage, readFailureReason } from "./alert";

async function resultFile(contents: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "alert-"));
  const file = path.join(directory, "render.json");

  await fs.writeFile(file, contents, "utf8");

  return file;
}

const quota = "Speech synthesis failed (429): rate_limit_exceeded: Rate limit reached for model playai-tts on tokens per day (TPD)";

test("a spent speech quota is named, not left as a status code", () => {
  const text = failureMessage(quota);

  assert.match(text, /quota/i);
  assert.ok(!text.includes("429"));
});

test("a spent quota says the episode is not lost", () => {
  // The arc is tracked in history.json, not the calendar, so a missed night
  // shifts the run rather than skipping a part. Saying so is the whole point.
  assert.match(failureMessage(quota), /still at the front of the queue|not lost|nothing is skipped/i);
});

test("a 429 from the script model is recognised too", () => {
  assert.match(failureMessage("Script generation failed (429): rate_limit_exceeded"), /quota/i);
});

test("an empty queue is reported as writing owed, not a broken build", () => {
  const text = failureMessage("Every queued arc is spent:\n  scripts/floor-four — all 5 published");

  assert.match(text, /queue/i);
  assert.ok(!/quota/i.test(text));
});

test("an unrecognised failure keeps its own words", () => {
  assert.match(failureMessage("Remotion ran out of memory"), /Remotion ran out of memory/);
});

test("the run url is included when the workflow provides one", () => {
  const text = failureMessage("anything", {
    serverUrl: "https://github.com",
    repository: "bekircancsc/ai-video-generator",
    runId: "123",
  });

  assert.match(text, /https:\/\/github\.com\/bekircancsc\/ai-video-generator\/actions\/runs\/123/);
});

test("a local run without workflow variables carries no dangling url", () => {
  const text = failureMessage("anything", {});

  assert.ok(!text.includes("undefined"));
  assert.ok(!text.includes("actions/runs"));
});

test("the reason is read out of the render result", async () => {
  const file = await resultFile(JSON.stringify({ ok: false, error: "Every queued arc is spent" }));

  assert.equal(await readFailureReason(file), "Every queued arc is spent");
});

test("a missing result file still yields a reason rather than throwing", async () => {
  const reason = await readFailureReason(path.join(os.tmpdir(), "nope", "render.json"));

  assert.ok(reason !== undefined);
  assert.match(reason, /before it could write/i);
});

test("a result file that is not json does not hide the failure", async () => {
  const reason = await readFailureReason(await resultFile("Render failed: boom\n"));

  assert.ok(reason !== undefined);
  assert.match(reason, /boom/);
});

test("a successful result is not something to alert about", async () => {
  const file = await resultFile(JSON.stringify({ ok: true, mp4: "out/x.mp4" }));

  assert.equal(await readFailureReason(file), undefined);
});

test("a failure after a good render says the video exists", () => {
  // The upload or the history commit fell over. There is a rendered video kept
  // as an artifact, and "nothing rendered" would send someone the wrong way.
  const text = failureMessage(undefined);

  assert.match(text, /rendered/i);
  assert.ok(!text.includes("undefined"));
});

test("a downstream failure is not blamed on the quota", () => {
  assert.ok(!/quota/i.test(failureMessage(undefined)));
});
