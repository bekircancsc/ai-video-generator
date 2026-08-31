import React from "react";
import { Audio, staticFile, useVideoConfig } from "remotion";
import { musicGain, type SpeechSpan } from "../services/music";

type MusicBedProps = {
  src: string;
  spans: SpeechSpan[];
  totalFrames: number;
};

/**
 * The one piece of audio that spans the whole video. It sits outside the scene
 * sequences, so its frames are absolute and its volume can be computed against
 * the finished timeline.
 */
export const MusicBed: React.FC<MusicBedProps> = ({ src, spans, totalFrames }) => {
  const { fps } = useVideoConfig();

  return (
    <Audio
      src={staticFile(src)}
      volume={(frame) => musicGain(frame, spans, totalFrames, fps)}
    />
  );
};
