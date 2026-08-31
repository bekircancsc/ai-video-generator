import { z } from "zod";

export const captionWordSchema = z.object({
  word: z.string(),
  // Seconds, relative to the start of the scene's own audio clip.
  start: z.number(),
  end: z.number(),
});

export const videoSceneSchema = z.object({
  id: z.string(),
  text: z.string(),
  subtext: z.string().default(""),
  narration: z.string().default(""),
  durationInFrames: z.number().int().positive(),
  themeColor: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#6d5df6"),
  keywords: z.array(z.string()).default([]),
  // One sentence describing the picture for this scene. Written by the script
  // model; empty on hand-written payloads, where the imagery stage falls back
  // to keywords.
  imagePrompt: z.string().default(""),
  // Written by the imagery stage. Relative to public/, e.g. images/3f2a.jpg
  imageSrc: z.string().optional(),
  // Written by the voiceover stage. Relative to public/, e.g. audio/3f2a.wav
  audioSrc: z.string().optional(),
  // Written by the captions stage, timed against audioSrc.
  captions: z.array(captionWordSchema).optional(),
});

export const videoPayloadSchema = z.object({
  title: z.string(),
  fps: z.number().int().positive().default(30),
  scenes: z.array(videoSceneSchema).min(1),
  aspectRatio: z.string().regex(/^\d+:\d+$/).default("9:16"),
  // Written by the music stage. Relative to public/, e.g. music/9f2a1c.wav
  musicSrc: z.string().optional(),
});

export type VideoScene = z.infer<typeof videoSceneSchema>;
export type VideoPayload = z.infer<typeof videoPayloadSchema>;
export type CaptionWord = z.infer<typeof captionWordSchema>;

export type inputProps = {
  video: VideoPayload;
};
