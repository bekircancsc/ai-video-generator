import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunResult } from "../services/result";
import {
  accessToken,
  buildUploadMetadata,
  scheduledPublishTime,
  setThumbnail,
  uploadVideo,
  watchUrl,
} from "../services/youtube";
import { sendMessage } from "../services/telegram";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

/**
 * Reads what a `--json` render printed.
 *
 * A failed render writes `{ok: false}` and the publisher must not treat that as
 * something to upload — the file exists either way, and the difference is one
 * field.
 */
export async function readRunResult(file: string): Promise<RunResult> {
  let raw: string;

  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    throw new Error(`Could not read the render result: ${file}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${file} is not JSON. It should be exactly what \`run.mjs --json\` printed on stdout; ` +
        "a log line in there means stdout and stderr were mixed.",
    );
  }

  const result = parsed as RunResult & { error?: string };

  if (result.ok !== true) {
    throw new Error(`The render failed, so there is nothing to publish: ${result.error ?? "no reason given"}`);
  }

  if (!result.mp4) {
    throw new Error(`${file} names no video file.`);
  }

  return result;
}

/**
 * How short the queue has to get before the announcement mentions it.
 *
 * Two nights, so the warning arrives with a weekend's notice rather than on
 * the evening it matters.
 */
export const LOW_QUEUE_NIGHTS = 2;

/**
 * The state of the queue, when it is worth a line and not otherwise.
 *
 * A healthy queue says nothing: a warning that arrives every night is one
 * nobody reads on the night it counts. Nought is worded rather than counted,
 * because "0 nights left" reads like a statistic and this is the only case
 * where tomorrow actually publishes nothing.
 */
function queueNote(remaining: number | undefined): string | undefined {
  if (remaining === undefined || remaining > LOW_QUEUE_NIGHTS) {
    return undefined;
  }

  if (remaining <= 0) {
    return "That was the last part queued - nothing goes out tomorrow until another is written.";
  }

  return `${remaining} night${remaining === 1 ? "" : "s"} left in the queue.`;
}

/**
 * The message the finished upload announces itself with.
 *
 * It states the deadline rather than asking for an action, because the video
 * publishes itself: doing nothing is consent, and the only thing worth knowing
 * is how long there is left to disagree.
 */
export function announcement(result: RunResult, videoId: string, publishAt?: string): string {
  const when = publishAt
    ? `Goes public ${new Date(publishAt).toLocaleString("en-GB", {
        timeZone: "Europe/Istanbul",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })} Istanbul time. Delete it before then if it came out wrong.`
    : "Private. Review it before publishing.";

  return [`Ready: ${result.title}`, watchUrl(videoId), `${result.durationSeconds}s. ${when}`, queueNote(result.queueRemaining)]
    .filter(Boolean)
    .join("\n");
}

export async function publish(result: RunResult, publishAt?: string): Promise<string> {
  const token = await accessToken();

  const video = await fs.readFile(path.resolve(rootDir, result.mp4));

  console.log(`Uploading ${result.mp4} (${(video.length / 1_000_000).toFixed(1)} MB) as "${result.title}"`);

  const videoId = await uploadVideo({
    token,
    video,
    metadata: buildUploadMetadata({
      title: result.title,
      description: result.description,
      tags: result.tags,
      publishAt,
    }),
  });

  console.log(`Uploaded as ${watchUrl(videoId)}`);

  // After the upload, because a thumbnail needs a video to belong to, and
  // tolerated on failure: a cover is worth less than the video is, and a
  // channel that cannot set custom thumbnails would otherwise lose both.
  if (result.cover) {
    try {
      await setThumbnail({ token, videoId, cover: await fs.readFile(path.resolve(rootDir, result.cover)) });
      console.log("Cover set.");
    } catch (error) {
      console.warn(`[cover] ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return videoId;
}

if (isDirectRun) {
  const run = async () => {
    const index = process.argv.indexOf("--result");
    const file = index === -1 ? undefined : process.argv[index + 1];

    if (!file || file.startsWith("--")) {
      throw new Error("Usage: node --import tsx src/pipeline/publish.ts --result <render.json>");
    }

    const result = await readRunResult(path.resolve(process.cwd(), file));
    const publishAt = scheduledPublishTime();
    const videoId = await publish(result, publishAt);

    console.log(`Scheduled to go public at ${publishAt}.`);

    // Last, and tolerated on failure: the video is up either way, and a failed
    // notification is not worth a red build over an uploaded video.
    try {
      await sendMessage(announcement(result, videoId, publishAt));
      console.log("Told Telegram.");
    } catch (error) {
      console.warn(`[telegram] ${error instanceof Error ? error.message : String(error)}`);
    }

    process.stdout.write(`${JSON.stringify({ ok: true, videoId, url: watchUrl(videoId) })}\n`);
  };

  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    console.error("Publish failed:", message);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
