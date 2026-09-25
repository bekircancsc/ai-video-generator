import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { HOOK_SECONDS } from "../services/timing";

type HookTitleProps = {
  text: string;
};

/** Frames the title takes to fade once its time is up. */
const FADE_OUT_FRAMES = 8;

/**
 * The opening scene's headline, over the first two seconds only.
 *
 * Scene headlines were taken off the frame because they competed with the
 * captions. This one comes back for the opening alone: 80% of feed viewers
 * swiped away within the first seconds, when the frame was a dark still with
 * no words on it yet. It is fully visible on frame zero — no fade in — because
 * frame zero is what the feed shows first.
 */
export const HookTitle: React.FC<HookTitleProps> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const end = Math.round(HOOK_SECONDS * fps);

  const opacity = interpolate(frame, [end - FADE_OUT_FRAMES, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (!text.trim() || opacity === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: "22%",
        padding: "0 90px",
        textAlign: "center",
        opacity,
        fontSize: 96,
        fontWeight: 900,
        lineHeight: 1.05,
        letterSpacing: "-0.02em",
        textTransform: "uppercase",
        color: "#ffffff",
        textShadow: "0 6px 28px rgba(2, 4, 9, 0.9)",
      }}
    >
      {text}
    </div>
  );
};
