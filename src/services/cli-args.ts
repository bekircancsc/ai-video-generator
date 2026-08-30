import { MAX_SCENES, MIN_SCENES } from "./script-schema";

/**
 * Reads the generation flags, tolerating a bare positional topic.
 * `--scenes` is validated here so a bad value fails before any model call.
 */
export function parseArgs(argv: string[]) {
  const flagValue = (flag: string) => {
    const index = argv.indexOf(flag);

    if (index === -1) {
      return undefined;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }

    return value;
  };

  const payloadFile = flagValue("--payload");
  const topicFlag = flagValue("--topic");
  const niche = flagValue("--niche");
  const scenesFlag = flagValue("--scenes");

  let sceneCount: number | undefined;

  if (scenesFlag !== undefined) {
    sceneCount = Number(scenesFlag);

    if (!Number.isInteger(sceneCount) || sceneCount < MIN_SCENES || sceneCount > MAX_SCENES) {
      throw new Error(`--scenes must be a whole number between ${MIN_SCENES} and ${MAX_SCENES}, got "${scenesFlag}"`);
    }
  }

  const consumed = new Set([
    topicFlag,
    payloadFile,
    niche,
    scenesFlag,
    "--topic",
    "--payload",
    "--niche",
    "--scenes",
    "--no-audio",
    "--",
  ]);
  const positional = argv.filter((arg) => !consumed.has(arg)).join(" ").trim();

  return {
    payloadFile,
    topic: topicFlag ?? positional,
    niche,
    sceneCount,
    audio: !argv.includes("--no-audio"),
  };
}
