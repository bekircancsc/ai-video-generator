import { MAX_SCENES, MIN_SCENES } from "./script-schema";

/**
 * Reads the generation flags, tolerating a bare positional topic.
 * `--scenes` is validated here so a bad value fails before any model call.
 */
export function parseArgs(argv: string[]) {
  const consumedIndices = new Set<number>();

  const flagValue = (flag: string) => {
    const index = argv.indexOf(flag);

    if (index === -1) {
      return undefined;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }

    consumedIndices.add(index);
    consumedIndices.add(index + 1);

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

  const positional = argv
    .filter(
      (arg, i) =>
        !consumedIndices.has(i) &&
        arg !== "--no-audio" &&
        arg !== "--no-images" &&
        arg !== "--no-music" &&
        arg !== "--no-cover" &&
        arg !== "--",
    )
    .join(" ")
    .trim();

  return {
    payloadFile,
    topic: topicFlag ?? positional,
    niche,
    sceneCount,
    audio: !argv.includes("--no-audio"),
    images: !argv.includes("--no-images"),
    music: !argv.includes("--no-music"),
    cover: !argv.includes("--no-cover"),
  };
}
