import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { rotateHue } from "../services/palette";
import { seedFromId, seededUnit } from "../services/seed";

/** The near-black the pipeline already used, kept so text contrast is unchanged. */
const BASE_COLOR = "#030712";

/** Hue offsets for the three clouds, giving an analogous palette from one colour. */
const HUE_OFFSETS = [0, 32, -28];

/**
 * Film grain as an inline SVG turbulence pattern. A texture rather than a
 * filter: filters are recomputed per frame by the browser and this is not.
 */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter>" +
  "<rect width='140' height='140' filter='url(%23n)' opacity='0.55'/></svg>\")";

type BackgroundProps = {
  themeColor: string;
  sceneId: string;
  durationInFrames: number;
};

export const Background: React.FC<BackgroundProps> = ({ themeColor, sceneId, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const seed = seedFromId(sceneId);

  // Normalised to the scene's own length, so a short scene drifts as far as a
  // long one instead of appearing frozen.
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // A few pixels of shift per frame reads as shimmer without any randomness.
  const grainShift = (frame % 5) * 9;

  return (
    <AbsoluteFill style={{ backgroundColor: BASE_COLOR, overflow: "hidden" }}>
      {HUE_OFFSETS.map((offset, index) => {
        const startX = 8 + seededUnit(seed, index * 4) * 84;
        const startY = 8 + seededUnit(seed, index * 4 + 1) * 84;
        const driftX = (seededUnit(seed, index * 4 + 2) - 0.5) * 34;
        const driftY = (seededUnit(seed, index * 4 + 3) - 0.5) * 34;
        const size = Math.max(width, height) * (0.36 + index * 0.05);

        return (
          <div
            key={offset}
            style={{
              position: "absolute",
              width: size,
              height: size,
              left: `${startX + driftX * progress}%`,
              top: `${startY + driftY * progress}%`,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              borderRadius: "50%",
              // The gradient's own falloff is what makes the cloud soft. A CSS
              // blur would look the same and cost far more per frame.
              background: `radial-gradient(circle, ${rotateHue(themeColor, offset)} 0%, rgba(3, 7, 18, 0) 52%)`,
              opacity: 0.44 - index * 0.07,
              transform: `scale(${1 + progress * 0.16})`,
            }}
          />
        );
      })}

      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: GRAIN,
          backgroundPosition: `${grainShift}px ${grainShift}px`,
          opacity: 0.09,
          mixBlendMode: "overlay",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 35%, rgba(2, 4, 9, 0.6) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
