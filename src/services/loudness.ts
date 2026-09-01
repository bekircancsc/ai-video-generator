import { z } from "zod";

/**
 * Loudness policy for the finished file.
 *
 * Every render leaves the mix wherever the narration and the bed happen to
 * land, which is around -22 LUFS. YouTube normalises to about -14 and only
 * ever turns content down, never up, so a quiet upload simply plays quiet
 * next to everything around it. The fix belongs here, after the render,
 * because integrated loudness is a property of the finished mix: speech and
 * music are separate until Remotion sums them.
 *
 * Pure and free of Node built-ins, so the argument building and the parsing
 * can be tested without spawning anything.
 */

/** What streaming platforms normalise to. */
export const TARGET_LUFS = -14;

/** Ceiling for the true peak, leaving room for lossy-codec overshoot. */
export const TRUE_PEAK_CEILING = -1.5;

/** Loudness range to aim for. Wide enough to leave the ducking audible. */
export const TARGET_RANGE = 11;

/** Bitrate for the re-encoded audio track. The video stream is copied, not re-encoded. */
export const AUDIO_BITRATE = "192k";

const measurementSchema = z.object({
  input_i: z.string(),
  input_tp: z.string(),
  input_lra: z.string(),
  input_thresh: z.string(),
});

export type LoudnessMeasurement = z.infer<typeof measurementSchema>;

function filter(extra = ""): string {
  return `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK_CEILING}:LRA=${TARGET_RANGE}${extra}`;
}

/** First pass: measure the file and print the numbers, decoding to nowhere. */
export function measureArgs(input: string): string[] {
  return ["-hide_banner", "-nostats", "-i", input, "-af", `${filter(":print_format=json")}`, "-f", "null", "-"];
}

/**
 * Second pass: apply the correction the measurement implies.
 *
 * `linear=true` scales the whole file by one factor rather than riding the
 * level as it goes. That matters here: the bed already ducks under speech on
 * purpose, and a dynamic pass would flatten exactly that movement back out.
 * The video stream is copied, so this costs no picture quality and no time
 * proportional to the frame count.
 */
export function applyArgs(input: string, output: string, measured: LoudnessMeasurement): string[] {
  const measurements =
    `:measured_I=${measured.input_i}` +
    `:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}` +
    `:measured_thresh=${measured.input_thresh}` +
    ":linear=true";

  return [
    "-hide_banner",
    "-nostats",
    "-y",
    "-i",
    input,
    "-map",
    "0:v",
    "-map",
    "0:a",
    "-c:v",
    "copy",
    "-af",
    filter(measurements),
    "-c:a",
    "aac",
    "-b:a",
    AUDIO_BITRATE,
    output,
  ];
}

/**
 * Pulls the measurement out of the first pass's output.
 *
 * ffmpeg writes the JSON block to stderr, after everything else it has to
 * say, so the last balanced object in the stream is the one wanted. Anything
 * that does not carry all four numbers is a failure to measure — a file with
 * no audio track, most often — and throws rather than returning a partial
 * measurement the second pass would apply as if it were real.
 */
export function parseLoudnormJson(stderr: string): LoudnessMeasurement {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("ffmpeg printed no loudness measurement");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(stderr.slice(start, end + 1));
  } catch (error) {
    throw new Error(`Loudness measurement was not valid JSON: ${String(error)}`);
  }

  const result = measurementSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Loudness measurement was missing fields: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }

  return result.data;
}
