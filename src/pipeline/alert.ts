import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendMessage } from "../services/telegram";

const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

/** Where the failed run can be read back, when a workflow is the one running us. */
export type RunContext = {
  serverUrl?: string;
  repository?: string;
  runId?: string;
};

/**
 * Why the run published nothing, or undefined if it actually succeeded.
 *
 * Every branch returns something a person can act on, because this is the last
 * thing that speaks before the night goes quiet. A missing file is itself the
 * answer — the render died before it could write one — and a file that is not
 * JSON is handed over verbatim rather than discarded, since whatever is in
 * there is the only account of the failure that exists.
 */
export async function readFailureReason(file: string): Promise<string | undefined> {
  let raw: string;

  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return "The render stopped before it could write a result. The run log has the last thing it said.";
  }

  try {
    const parsed = JSON.parse(raw) as { ok?: boolean; error?: string };

    if (parsed.ok === true) {
      return undefined;
    }

    return parsed.error?.trim() || "The render reported a failure without saying why.";
  } catch {
    return raw.trim().slice(0, 400) || "The render wrote an empty result.";
  }
}

/** Reads as a spent allowance rather than a fault, whichever model ran out. */
function isQuota(reason: string): boolean {
  return /\b429\b|rate.?limit|tokens per day|\bquota\b/i.test(reason);
}

/**
 * The message sent when a night publishes nothing.
 *
 * Two failures get worded rather than quoted, because their raw text is a
 * status code standing in front of the one fact that matters. A spent quota is
 * not a fault and nothing is lost by it: the arc's position lives in
 * history.json rather than in the calendar, so a missed night moves the
 * schedule along by a day instead of dropping an episode. An empty queue is
 * writing owed, and saying "failed" about it sends someone to debug a workflow
 * that is working exactly as designed.
 */
export function failureMessage(reason: string | undefined, context: RunContext = {}): string {
  const { serverUrl, repository, runId } = context;

  // No reason means the render itself was fine, so the video exists and the
  // failure is downstream of it. Saying nothing rendered would send someone
  // looking for a bug in the part of the run that worked.
  const explanation = reason === undefined
    ? "The video rendered but did not get published. It is kept as an artifact on the run, so nothing has to be rendered again."
    : isQuota(reason)
    ? "The daily speech quota is spent, so there was nothing to upload. It resets on its own, and " +
      "tonight's part is still at the front of the queue — nothing is skipped, the schedule just moves along a day."
    : /queued arc is spent/i.test(reason)
      ? "The queue is empty: every arc in it has been published. The next part has to be written before " +
        "anything can go out. Nothing is broken."
      : reason;

  const link = serverUrl && repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : undefined;

  return ["Nothing published tonight.", explanation, link].filter(Boolean).join("\n");
}

if (isDirectRun) {
  const run = async () => {
    const index = process.argv.indexOf("--result");
    const file = index === -1 ? undefined : process.argv[index + 1];

    if (!file || file.startsWith("--")) {
      throw new Error("Usage: node --import tsx src/pipeline/alert.ts --result <render.json>");
    }

    const reason = await readFailureReason(path.resolve(process.cwd(), file));

    const text = failureMessage(reason, {
      serverUrl: process.env.GITHUB_SERVER_URL,
      repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
    });

    console.log(text);

    await sendMessage(text);
    console.log("Told Telegram.");
  };

  // Never adds a failure of its own: the job is already red and the only thing
  // a non-zero exit here would change is which error someone reads first.
  run().catch((error) => {
    console.warn(`[alert] ${error instanceof Error ? error.message : String(error)}`);
  });
}
