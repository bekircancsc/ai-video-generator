import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { Captions } from "./Captions";
import { Background } from "./Background";
import { LEAD_IN_SECONDS } from "../services/timing";
import { BASE_COLOR } from "../services/palette";
import type { VideoScene } from "../types/video";

type SceneProps = {
  scene: VideoScene;
};

/**
 * A scene is its picture, its narration and its captions — nothing else.
 *
 * The frame carried a keyword pill in the top corner and the scene's own
 * headline across the middle. Both competed with the captions for the same
 * attention, and the headline said the same thing the voice was already
 * saying, a beat out of step with it. Captions are the only text now: they
 * are timed to the word being spoken, so they can never fall out of sync
 * with it. `text` and `subtext` are still carried on the scene and still
 * printed on the cover, which is read in silence and needs them.
 */
export const Scene: React.FC<SceneProps> = ({ scene }) => {
  const { fps } = useVideoConfig();
  const leadInFrames = Math.round(LEAD_IN_SECONDS * fps);

  return (
    // Safety-net ground colour in case Background ever fails to cover the
    // frame; AbsoluteFill already sets overflow: hidden, so that is not
    // repeated here.
    <AbsoluteFill style={{ backgroundColor: BASE_COLOR }}>
      <Background
        themeColor={scene.themeColor}
        sceneId={scene.id}
        durationInFrames={scene.durationInFrames}
        imageSrc={scene.imageSrc}
      />
      {scene.audioSrc ? (
        <Sequence from={leadInFrames}>
          <Audio src={staticFile(scene.audioSrc)} />
        </Sequence>
      ) : null}

      {scene.captions && scene.captions.length > 0 ? (
        <Captions words={scene.captions} themeColor={scene.themeColor} />
      ) : null}
    </AbsoluteFill>
  );
};
