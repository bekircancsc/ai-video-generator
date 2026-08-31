import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene } from "./components/Scene";
import { sceneStartFrames, transitionFrames } from "./services/timing";
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
  // The ramp ends one frame before the overlap does: a sequence covering N
  // frames is last on screen at its frame N-1, so reaching full opacity at N
  // would leave a visible step on the frame the outgoing scene disappears.
  const opacity =
    fadeInFrames > 0
      ? interpolate(frame, [0, Math.max(1, fadeInFrames - 1)], [0, 1], {
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
  const { fps } = useVideoConfig();
  const overlap = transitionFrames(fps);
  const starts = sceneStartFrames(
    video.scenes.map((scene) => scene.durationInFrames),
    overlap,
  );

  return (
    <>
      {video.scenes.map((scene, index) => (
        <Sequence key={scene.id} from={starts[index]} durationInFrames={scene.durationInFrames}>
          {/* The opening scene has nothing to dissolve from, so it starts opaque. */}
          <DissolvingScene scene={scene} fadeInFrames={index === 0 ? 0 : overlap} />
        </Sequence>
      ))}
    </>
  );
};
