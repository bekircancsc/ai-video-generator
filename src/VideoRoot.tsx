import React, { type ReactNode } from "react";
import { Sequence } from "remotion";
import { Scene } from "./components/Scene";
import type { VideoPayload } from "./types/video";

type VideoRootProps = {
  video: VideoPayload;
};

export const VideoRoot: React.FC<VideoRootProps> = ({ video }) => {
  let startFrame = 0;

  const scenes: ReactNode[] = video.scenes.map((scene: VideoPayload["scenes"][number]) => {
    const currentStart = startFrame;
    startFrame += scene.durationInFrames;

    return (
      <Sequence key={scene.id} from={currentStart} durationInFrames={scene.durationInFrames}>
        <Scene scene={scene} />
      </Sequence>
    );
  });

  return <>{scenes}</>;
};
