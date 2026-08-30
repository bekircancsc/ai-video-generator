import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "./AnimatedText";
import { Captions } from "./Captions";
import { LEAD_IN_SECONDS } from "../services/timing";
import type { VideoScene } from "../types/video";

type SceneProps = {
  scene: VideoScene;
};

export const Scene: React.FC<SceneProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const bgGlow = interpolate(frame, [0, scene.durationInFrames], [0.2, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const { fps } = useVideoConfig();
  const leadInFrames = Math.round(LEAD_IN_SECONDS * fps);
  const hasCaptions = Boolean(scene.captions && scene.captions.length > 0);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at center, ${scene.themeColor} 0%, #0a0d1a 48%, #030712 100%)`,
        overflow: "hidden",
      }}
    >
      {scene.audioSrc ? (
        <Sequence from={leadInFrames}>
          <Audio src={staticFile(scene.audioSrc)} />
        </Sequence>
      ) : null}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at center, ${scene.themeColor}${Math.round(bgGlow * 255)
            .toString(16)
            .padStart(2, "0")} 0%, rgba(7, 10, 18, 0.0) 52%, rgba(2, 4, 9, 0.8) 100%)`,
        }}
      />

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
