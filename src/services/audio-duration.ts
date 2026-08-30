export type WavFormat = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
};

/**
 * Reads the format and data chunks out of a RIFF/WAVE buffer.
 * Chunks are walked rather than assuming the common 44-byte header, because
 * encoders are free to emit metadata chunks before the audio data.
 */
export function parseWavHeader(buffer: Buffer): WavFormat {
  const isRiffWave =
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE";

  if (!isRiffWave) {
    throw new Error("Audio is not a RIFF/WAVE file");
  }

  let format: Omit<WavFormat, "dataBytes"> | undefined;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (chunkId === "fmt " && body + 16 <= buffer.length) {
      format = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    }

    if (chunkId === "data") {
      if (!format) {
        throw new Error("WAVE data chunk appeared before its fmt chunk");
      }

      return {
        ...format,
        // A truncated download can declare more bytes than it actually carries.
        dataBytes: Math.min(chunkSize, buffer.length - body),
      };
    }

    // Chunks are word aligned, so an odd size carries a trailing pad byte.
    offset = body + chunkSize + (chunkSize % 2);
  }

  throw new Error("WAVE file contains no data chunk");
}

/** Duration in seconds of a RIFF/WAVE buffer. */
export function getWavDurationSeconds(buffer: Buffer): number {
  const { sampleRate, channels, bitsPerSample, dataBytes } = parseWavHeader(buffer);
  const bytesPerFrame = channels * (bitsPerSample / 8);

  if (sampleRate <= 0 || bytesPerFrame <= 0) {
    throw new Error("WAVE file declares an unusable sample rate or frame size");
  }

  return dataBytes / (sampleRate * bytesPerFrame);
}
