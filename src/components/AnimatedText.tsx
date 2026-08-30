import React from "react";
import { spring, useCurrentFrame } from "remotion";

type AnimatedTextProps = {
  text: string;
  subtext: string;
  themeColor: string;
  accent?: string;
};

export const AnimatedText: React.FC<AnimatedTextProps> = ({ text, subtext, themeColor, accent = "#ffffff" }) => {
  const frame = useCurrentFrame();
  const scale = spring({
    fps: 30,
    frame,
    config: { damping: 12, mass: 0.5, stiffness: 100 },
    durationInFrames: 18,
  });

  const opacity = spring({
    fps: 30,
    frame,
    config: { damping: 20, mass: 0.5, stiffness: 90 },
    durationInFrames: 18,
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: 48,
        textAlign: "center",
        opacity,
        transform: `scale(${0.82 + scale * 0.18})`,
      }}
    >
      <div
        style={{
          fontSize: 64,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          color: accent,
          textShadow: `0 0 18px ${themeColor}66`,
          marginBottom: 18,
          maxWidth: 760,
          lineHeight: 1.05,
        }}
      >
        {text}
      </div>

      {subtext ? (
        <div
          style={{
            fontSize: 30,
            fontWeight: 500,
            color: "rgba(255,255,255,0.8)",
            maxWidth: 700,
            lineHeight: 1.2,
          }}
        >
          {subtext}
        </div>
      ) : null}
    </div>
  );
};
