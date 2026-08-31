import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { FONT_FAMILY } from "../fonts";
import { coverHeadlineSize, coverPlan } from "../services/cover";
import { BASE_COLOR, HUE_OFFSETS, rotateHue, toTransparentRgba, withAlpha } from "../services/palette";
import type { VideoPayload } from "../types/video";

/**
 * Heavier at the bottom than the video's scrim: the headline is larger, sits
 * lower, and has to hold at the size a feed shows it.
 */
const COVER_SCRIM =
  "linear-gradient(to bottom, rgba(2, 4, 9, 0.45) 0%, rgba(2, 4, 9, 0.15) 28%, " +
  "rgba(2, 4, 9, 0.72) 62%, rgba(2, 4, 9, 0.94) 100%)";

type CoverProps = {
  video: VideoPayload;
};

/**
 * The thumbnail. Deliberately static — no `useCurrentFrame`, no spring — so
 * the single frame it renders is the finished picture rather than the first
 * frame of an animation.
 */
export const Cover: React.FC<CoverProps> = ({ video }) => {
  const { imageSrc, themeColor, headline, kicker } = coverPlan(video);

  return (
    <AbsoluteFill style={{ backgroundColor: BASE_COLOR, overflow: "hidden", fontFamily: FONT_FAMILY }}>
      {imageSrc ? (
        <Img
          src={staticFile(imageSrc)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        // No picture anywhere — a still of the drawn background, so a cover is
        // produced even for a --no-images render.
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              `radial-gradient(circle at 30% 24%, ${rotateHue(themeColor, HUE_OFFSETS[0])} 0%, ${toTransparentRgba(BASE_COLOR)} 56%), ` +
              `radial-gradient(circle at 74% 66%, ${rotateHue(themeColor, HUE_OFFSETS[1])} 0%, ${toTransparentRgba(BASE_COLOR)} 58%)`,
          }}
        />
      )}

      <div style={{ position: "absolute", inset: 0, background: COVER_SCRIM }} />

      <div style={{ position: "absolute", left: 84, right: 84, bottom: 240 }}>
        <div
          style={{
            fontSize: coverHeadlineSize(headline),
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1.02,
            color: "#f8fafc",
            textShadow: "0 10px 44px rgba(2, 4, 9, 0.9)",
            // The model writes the title, and a language that compounds its
            // nouns can hand back one unbreakable word wider than the column.
            // Without this the frame's overflow: hidden slices it; with it the
            // word wraps and every character survives.
            overflowWrap: "anywhere",
          }}
        >
          {headline}
        </div>

        <div
          style={{
            width: 132,
            height: 10,
            margin: "36px 0 28px",
            borderRadius: 999,
            backgroundColor: themeColor,
            boxShadow: `0 0 36px ${withAlpha(themeColor, 0.65)}`,
          }}
        />

        {kicker ? (
          <div
            style={{
              fontSize: 40,
              fontWeight: 500,
              lineHeight: 1.25,
              color: "rgba(248, 250, 252, 0.82)",
              overflowWrap: "anywhere",
            }}
          >
            {kicker}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
