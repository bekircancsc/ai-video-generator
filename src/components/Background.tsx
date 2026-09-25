import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BASE_COLOR, HUE_OFFSETS, rotateHue, toTransparentRgba } from "../services/palette";
import { seedFromId, seededUnit } from "../services/seed";

/**
 * Film grain as an inline SVG turbulence pattern. A texture rather than a
 * filter: filters are recomputed per frame by the browser and this is not.
 */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter>" +
  "<rect width='140' height='140' filter='url(%23n)' opacity='0.55'/></svg>\")";

/**
 * The clouds' size, falloff and opacity were jointly tuned to keep the
 * near-black ground visible underneath them. Raising any one of these on its
 * own reproduces the original failure: a full-frame colour wash with no dark
 * ground showing through. Change them together, and re-check against a
 * rendered frame, not in isolation.
 */
const CLOUD_POSITION_RANGE_PERCENT = 84;
const CLOUD_POSITION_OFFSET_PERCENT = 8;
const CLOUD_DRIFT_RANGE_PERCENT = 34;
const CLOUD_BASE_SIZE_FACTOR = 0.36;
const CLOUD_SIZE_STEP_PER_INDEX = 0.05;
const CLOUD_GRADIENT_TRANSPARENT_STOP = "52%";
const CLOUD_BASE_OPACITY = 0.44;
const CLOUD_OPACITY_STEP_PER_INDEX = 0.07;
const CLOUD_SCALE_GROWTH = 0.16;

/**
 * The image is scaled past the frame over the scene so it never sits still.
 * Kept small on purpose: a stronger zoom pulls the eye off the caption.
 */
const IMAGE_ZOOM_GROWTH = 0.08;

/**
 * How hard the picture is pushed down so white text stays readable on it.
 * Heavier at the top and bottom, where the hook title and the captions sit.
 */
const IMAGE_SCRIM =
  "linear-gradient(to bottom, rgba(2, 4, 9, 0.6) 0%, rgba(2, 4, 9, 0.22) 34%, " +
  "rgba(2, 4, 9, 0.34) 62%, rgba(2, 4, 9, 0.72) 100%)";

/** A few pixels of grain shift per frame reads as shimmer without any randomness. */
const GRAIN_SHIFT_STEP_PX = 9;
const GRAIN_SHIFT_CYCLE_FRAMES = 5;
const GRAIN_LAYER_OPACITY = 0.09;

type BackgroundProps = {
  themeColor: string;
  sceneId: string;
  // Kept explicit even though useVideoConfig().durationInFrames would equal
  // this today: VideoRoot wraps every Scene in a Sequence with the same
  // duration. An explicit input beats an invisible dependency on being
  // mounted inside that per-scene Sequence, so keep passing it as a prop.
  durationInFrames: number;
  // Relative to public/, written by the imagery stage. Scenes without one fall
  // back to the drawn aurora, which is what every scene used before imagery
  // existed.
  imageSrc?: string;
};

export const Background: React.FC<BackgroundProps> = ({
  themeColor,
  sceneId,
  durationInFrames,
  imageSrc,
}) => {
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
  const grainShift = (frame % GRAIN_SHIFT_CYCLE_FRAMES) * GRAIN_SHIFT_STEP_PX;

  if (imageSrc) {
    return (
      <AbsoluteFill style={{ backgroundColor: BASE_COLOR, overflow: "hidden" }}>
        <Img
          src={staticFile(imageSrc)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${1 + progress * IMAGE_ZOOM_GROWTH})`,
          }}
        />

        <div style={{ position: "absolute", inset: 0, background: IMAGE_SCRIM }} />

        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: GRAIN,
            backgroundPosition: `${grainShift}px ${grainShift}px`,
            opacity: GRAIN_LAYER_OPACITY,
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
  }

  return (
    <AbsoluteFill style={{ backgroundColor: BASE_COLOR, overflow: "hidden" }}>
      {HUE_OFFSETS.map((offset, index) => {
        const startX = CLOUD_POSITION_OFFSET_PERCENT + seededUnit(seed, index * 4) * CLOUD_POSITION_RANGE_PERCENT;
        const startY =
          CLOUD_POSITION_OFFSET_PERCENT + seededUnit(seed, index * 4 + 1) * CLOUD_POSITION_RANGE_PERCENT;
        const driftX = (seededUnit(seed, index * 4 + 2) - 0.5) * CLOUD_DRIFT_RANGE_PERCENT;
        const driftY = (seededUnit(seed, index * 4 + 3) - 0.5) * CLOUD_DRIFT_RANGE_PERCENT;
        const size = Math.max(width, height) * (CLOUD_BASE_SIZE_FACTOR + index * CLOUD_SIZE_STEP_PER_INDEX);

        return (
          <div
            key={index}
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
              background: `radial-gradient(circle, ${rotateHue(themeColor, offset)} 0%, ${toTransparentRgba(BASE_COLOR)} ${CLOUD_GRADIENT_TRANSPARENT_STOP})`,
              opacity: CLOUD_BASE_OPACITY - index * CLOUD_OPACITY_STEP_PER_INDEX,
              transform: `scale(${1 + progress * CLOUD_SCALE_GROWTH})`,
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
          opacity: GRAIN_LAYER_OPACITY,
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
