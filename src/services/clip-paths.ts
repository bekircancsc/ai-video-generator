import crypto from "node:crypto";

/**
 * Owns the on-disk naming convention for a scene's narration clip and its
 * cached transcript. Node-side only (uses node:crypto) — never import this
 * from src/components/, src/Root.tsx or src/VideoRoot.tsx.
 */

/** Identifies a clip by its content, so unchanged narration is never re-synthesized. */
export function narrationCacheKey(narration: string, voice: string, model: string): string {
  return crypto.createHash("sha256").update(`${narration} ${voice} ${model}`).digest("hex").slice(0, 16);
}

/** Clip path (relative to public/) for a given cache key, e.g. audio/3f2a1b0c....wav */
export function clipPathFor(key: string): string {
  return `audio/${key}.wav`;
}

/** Filesystem-safe slug of a model id, since ids like "openai/whisper-1" carry a path separator. */
function slugifyModel(model: string): string {
  return model.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

/**
 * Transcript cache path (relative to public/) for a clip, scoped to the
 * transcription model used to produce it: audio/<key>.wav becomes
 * audio/<key>.<model-slug>.json. Scoping by model means switching
 * TRANSCRIBE_MODEL naturally invalidates the cache instead of silently
 * reusing timings from a different model.
 *
 * Throws instead of returning a path that collides with the audio path —
 * this keeps the transcript write structurally unable to clobber the clip.
 */
export function transcriptPathFor(audioSrc: string, transcribeModel: string): string {
  const slug = slugifyModel(transcribeModel);
  const transcriptPath = audioSrc.replace(/\.wav$/i, `.${slug}.json`);

  if (transcriptPath === audioSrc) {
    throw new Error(
      `Refusing to cache a transcript at the same path as its audio clip (${audioSrc}). ` +
        `Expected the clip path to end in ".wav".`
    );
  }

  return transcriptPath;
}
