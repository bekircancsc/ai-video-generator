import { seededUnit } from "./seed";

/**
 * Synthesizes the ambient bed the video plays under its narration.
 *
 * The project generates its visuals rather than sourcing them, and the
 * soundtrack follows the same rule: this is arithmetic, not a download. Node
 * only — it returns a Buffer.
 */

/** Bump when the synthesis changes, so cached beds are regenerated. */
export const MUSIC_FORMAT_VERSION = 1;

export const MUSIC_SAMPLE_RATE = 44100;

/** Roots to build on, in Hz: A2, B2, C3, D3. Low enough to stay under speech. */
const ROOTS = [110, 123.47, 130.81, 146.83];

/**
 * Two chords in semitones from the root: a minor triad, and the major chord a
 * major third below it. They share two notes, so the move between them is a
 * shift of colour rather than a change of scene.
 */
const CHORDS = [
  [0, 3, 7, 12],
  [-4, 0, 3, 8],
];

/** Seconds for one full pass through both chords. */
const CHORD_CYCLE_SECONDS = 16;

/** Fade written into the file itself, on top of the render-time envelope. */
const FILE_FADE_SECONDS = 1.5;

/** Peak the bed is normalized to before its fades, leaving headroom. */
const PEAK = 0.5;

function semitones(root: number, offset: number): number {
  return root * Math.pow(2, offset / 12);
}

/** One voice: a sine with a quiet octave above it, breathing on its own slow LFO. */
function voice(time: number, frequency: number, lfoRate: number, lfoPhase: number): number {
  const tremolo = 0.75 + 0.25 * Math.sin(2 * Math.PI * lfoRate * time + lfoPhase);
  const fundamental = Math.sin(2 * Math.PI * frequency * time);
  const octave = 0.35 * Math.sin(2 * Math.PI * frequency * 2 * time);

  return tremolo * (fundamental + octave);
}

function writeHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  const channels = 2;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM header length
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(MUSIC_SAMPLE_RATE, 24);
  header.writeUInt32LE(MUSIC_SAMPLE_RATE * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);

  return header;
}

/** A complete 16-bit stereo WAV of exactly `seconds`, drawn from `seed`. */
export function synthesizeBed(seed: number, seconds: number): Buffer {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`A music bed needs a positive length, got ${seconds}`);
  }

  const frames = Math.round(MUSIC_SAMPLE_RATE * seconds);
  const root = ROOTS[Math.floor(seededUnit(seed, 0) * ROOTS.length) % ROOTS.length];

  // One LFO rate and phase per voice, so the chord never pulses as one block.
  const voices = CHORDS.map((chord, chordIndex) =>
    chord.map((offset, noteIndex) => {
      const draw = chordIndex * CHORDS[0].length + noteIndex;

      return {
        frequency: semitones(root, offset),
        lfoRate: 0.05 + seededUnit(seed, draw + 1) * 0.07,
        lfoPhase: seededUnit(seed, draw + 9) * 2 * Math.PI,
      };
    }),
  );

  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  // A few cents apart, which is what makes the bed sound wide rather than flat.
  const detune = Math.pow(2, 4 / 1200);
  let peak = 0;

  for (let index = 0; index < frames; index += 1) {
    const time = index / MUSIC_SAMPLE_RATE;
    // Crossfades between the two chords and back over one cycle.
    const weight = 0.5 + 0.5 * Math.cos((2 * Math.PI * time) / CHORD_CYCLE_SECONDS);
    let l = 0;
    let r = 0;

    voices.forEach((chord, chordIndex) => {
      const mix = chordIndex === 0 ? weight : 1 - weight;

      if (mix <= 0) {
        return;
      }

      for (const note of chord) {
        l += mix * voice(time, note.frequency, note.lfoRate, note.lfoPhase);
        r += mix * voice(time, note.frequency * detune, note.lfoRate, note.lfoPhase + 1.1);
      }
    });

    left[index] = l;
    right[index] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }

  const scale = peak > 0 ? PEAK / peak : 0;
  const fadeFrames = Math.min(
    Math.round(FILE_FADE_SECONDS * MUSIC_SAMPLE_RATE),
    Math.floor(frames / 2),
  );
  const data = Buffer.alloc(frames * 4);

  for (let index = 0; index < frames; index += 1) {
    let envelope = 1;

    if (fadeFrames > 0) {
      envelope = Math.min(
        1,
        index / fadeFrames,
        Math.max(0, frames - 1 - index) / fadeFrames,
      );
    }

    const gain = scale * envelope;
    // 32767 would round up to the clipping value on a full-scale sample.
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[index] * gain)) * 32000), index * 4);
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, right[index] * gain)) * 32000),
      index * 4 + 2,
    );
  }

  return Buffer.concat([writeHeader(data.length), data]);
}
