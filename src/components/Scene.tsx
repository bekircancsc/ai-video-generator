import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { AnimatedText } from "./AnimatedText";
import { Captions } from "./Captions";
import { Background } from "./Background";
import { LEAD_IN_SECONDS } from "../services/timing";
import { BASE_COLOR } from "../services/palette";
import type { VideoScene } from "../types/video";

type SceneProps = {
  scene: VideoScene;
};

export const Scene: React.FC<SceneProps> = ({ scene }) => {
  const { fps } = useVideoConfig();
  const leadInFrames = Math.round(LEAD_IN_SECONDS * fps);
  const hasCaptions = Boolean(scene.captions && scene.captions.length > 0);

  return (
    // Safety-net ground colour in case Background ever fails to cover the
    // frame; AbsoluteFill already sets overflow: hidden, so that is not
    // repeated here.
    <AbsoluteFill style={{ backgroundColor: BASE_COLOR }}>
      <Background
        themeColor={scene.themeColor}
        sceneId={scene.id}
        durationInFrames={scene.durationInFrames}
      />
      {scene.audioSrc ? (
        <Sequence from={leadInFrames}>
          <Audio src={staticFile(scene.audioSrc)} />
        </Sequence>
      ) : null}

      <div
        style={{
          position: "absolute",
          left: 60,
          top: 60,
          border: `1px solid ${scene.themeColor}99`,
          borderRadius: 999,
          padding: "10px 16px",
          color: "white",
          fontSize: 14,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          background: "rgba(15, 23, 42, 0.35)",
        }}
      >
        {scene.keywords.slice(0, 3).join(" • ") || "AI STORY"}
      </div>

      <AnimatedText
        text={scene.text}
        subtext={hasCaptions ? "" : scene.subtext}
        themeColor={scene.themeColor}
        accent="#f8fafc"
      />

      {hasCaptions && scene.captions ? (
        <Captions words={scene.captions} themeColor={scene.themeColor} />
      ) : null}
    </AbsoluteFill>
  );
};
