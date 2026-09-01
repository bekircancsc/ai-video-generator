import path from "node:path";
import type { VideoPayload } from "../types/video";
import { timelineFrames, transitionFrames } from "./timing";

/**
 * What a `--json` run prints on success.
 *
 * This is the whole contract with whatever automates the CLI: paths are
 * repo-relative with forward slashes so they read the same on every platform,
 * and the listing fields are resolved here rather than by the caller, so no
 * consumer has to know that `youtube` is optional.
 */
export type RunResult = {
  ok: true;
  mp4: string;
  cover?: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  durationSeconds: number;
};

/** What a `--json` run prints when a stage aborted the render. */
export type RunFailure = {
  ok: false;
  error: string;
};

/** Repo-relative, forward-slashed, so a Windows path does not arrive full of backslashes. */
function relativePath(rootDir: string, target: string) {
  return path.relative(rootDir, target).split(path.sep).join("/");
}

/** Keeps the first occurrence of each keyword, so the order stays the scene order. */
function uniqueKeywords(payload: VideoPayload) {
  return [...new Set(payload.scenes.flatMap((scene) => scene.keywords))];
}

/**
 * How long the finished video runs.
 *
 * Not the sum of the scene durations: consecutive scenes overlap by the
 * dissolve, so the timeline is shorter than its parts. `timing.ts` is the one
 * place that arithmetic lives and this reuses it rather than restating it.
 */
export function videoDurationSeconds(payload: VideoPayload): number {
  const durations = payload.scenes.map((scene) => scene.durationInFrames);
  const frames = timelineFrames(durations, transitionFrames(payload.fps));

  return Number((frames / payload.fps).toFixed(2));
}

/**
 * Assembles the result object from a finished render.
 *
 * The three fallbacks matter: a hand-written payload carries no `youtube`
 * block, and it must still be uploadable. Title falls back to the payload
 * title, description to the narration read end to end — which is, after all,
 * exactly what the video says — and tags to the scene keywords.
 */
export function buildResult({
  payload,
  videoLocation,
  coverLocation,
  rootDir,
}: {
  payload: VideoPayload;
  videoLocation: string;
  coverLocation?: string;
  rootDir: string;
}): RunResult {
  const narration = payload.scenes
    .map((scene) => scene.narration.trim())
    .filter(Boolean)
    .join(" ");

  return {
    ok: true,
    mp4: relativePath(rootDir, videoLocation),
    ...(coverLocation ? { cover: relativePath(rootDir, coverLocation) } : {}),
    slug: path.basename(videoLocation, path.extname(videoLocation)),
    title: payload.youtube?.title || payload.title,
    description: payload.youtube?.description || narration,
    tags: payload.youtube?.tags?.length ? payload.youtube.tags : uniqueKeywords(payload),
    durationSeconds: videoDurationSeconds(payload),
  };
}
