/** Reads `--topic <value>` and `--payload <file>`, tolerating bare positional topics. */
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
  const consumed = new Set([topicFlag, payloadFile, "--topic", "--payload", "--no-audio", "--"]);
  const positional = argv.filter((arg) => !consumed.has(arg)).join(" ").trim();

  return {
    payloadFile,
    topic: topicFlag ?? positional,
    audio: !argv.includes("--no-audio"),
  };
}
