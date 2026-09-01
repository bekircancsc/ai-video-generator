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
  // Lets this scene's picture contain lettering. The image style block rules
  // text out by default, because text behind captions is noise and image
  // models render it as unreadable smears. A scene whose subject IS lettering
  // — a numbered panel, a sign, a screen — sets this and takes that risk.
  allowTextInImage: z.boolean().optional(),
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
  // How the video is listed once it is uploaded. Written by the script model,
  // which is also the author of what the video says — a second model writing
  // the listing would be a second author, and the two would drift.
  // Optional in zod so a hand-written payload stays valid; required in the JSON
  // Schema the model is handed, so a generated script always carries one.
  youtube: z
    .object({
      title: z.string(),
      description: z.string(),
      tags: z.array(z.string()).default([]),
    })
    .optional(),
  // Written by the music stage. Relative to public/, e.g. music/9f2a1c.wav
  musicSrc: z.string().optional(),
  // Which scene's picture the cover uses. Unset, the cover takes the first
  // scene that has one, which is the opening scene whenever its image
  // generated. Set it when a later scene carries the better thumbnail.
  coverSceneId: z.string().optional(),
});

export type VideoScene = z.infer<typeof videoSceneSchema>;
export type VideoPayload = z.infer<typeof videoPayloadSchema>;
export type CaptionWord = z.infer<typeof captionWordSchema>;

export type inputProps = {
  video: VideoPayload;
};
