import { z } from "zod";

export const videoSceneSchema = z.object({
  id: z.string(),
  text: z.string(),
  subtext: z.string().default(""),
  narration: z.string().default(""),
  durationInFrames: z.number().int().positive(),
  themeColor: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#6d5df6"),
  keywords: z.array(z.string()).default([]),
  // Written by the voiceover stage. Relative to public/, e.g. audio/3f2a.wav
  audioSrc: z.string().optional(),
});

export const videoPayloadSchema = z.object({
  title: z.string(),
  fps: z.number().int().positive().default(30),
  scenes: z.array(videoSceneSchema).min(1),
  aspectRatio: z.string().regex(/^\d+:\d+$/).default("9:16"),
});

export type VideoScene = z.infer<typeof videoSceneSchema>;
export type VideoPayload = z.infer<typeof videoPayloadSchema>;

export type inputProps = {
  video: VideoPayload;
};
