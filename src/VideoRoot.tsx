import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { Scene } from "./components/Scene";
import { sceneStartFrames, TRANSITION_FRAMES } from "./services/timing";
import type { VideoPayload, VideoScene } from "./types/video";

type VideoRootProps = {
  video: VideoPayload;
};

/**
 * One scene, faded in over the overlap it shares with the scene before it.
 * Sequences render in order, so this paints on top of the outgoing scene and
 * the two dissolve into each other rather than passing through black.
 */
const DissolvingScene: React.FC<{ scene: VideoScene; fadeInFrames: number }> = ({
  scene,
  fadeInFrames,
}) => {
  const frame = useCurrentFrame();
  const opacity =
    fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  return (
    <AbsoluteFill style={{ opacity }}>
      <Scene scene={scene} />
    </AbsoluteFill>
  );
};

export const VideoRoot: React.FC<VideoRootProps> = ({ video }) => {
  const starts = sceneStartFrames(video.scenes.map((scene) => scene.durationInFrames));

  return (
    <>
      {video.scenes.map((scene, index) => (
        <Sequence key={scene.id} from={starts[index]} durationInFrames={scene.durationInFrames}>
          {/* The opening scene has nothing to dissolve from, so it starts opaque. */}
          <DissolvingScene scene={scene} fadeInFrames={index === 0 ? 0 : TRANSITION_FRAMES} />
        </Sequence>
      ))}
    </>
  );
};
