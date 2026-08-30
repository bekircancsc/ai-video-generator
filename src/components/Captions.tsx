import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { groupCaptionWords } from "../services/caption-groups";
import { LEAD_IN_SECONDS } from "../services/timing";
import type { CaptionWord } from "../types/video";

type CaptionsProps = {
  words: CaptionWord[];
  themeColor: string;
};

export const Captions: React.FC<CaptionsProps> = ({ words, themeColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Word times are relative to the clip, which the scene delays by the lead-in.
  const toFrame = (seconds: number) => Math.round((LEAD_IN_SECONDS + seconds) * fps);

  const groups = groupCaptionWords(words);

  // A group holds the screen until the next one starts, so the gaps between
  // words never blank the caption out.
  const activeIndex = groups.findIndex((group, index) => {
    const next = groups[index + 1];
    return frame >= toFrame(group.start) && (!next || frame < toFrame(next.start));
  });

  if (activeIndex === -1) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "18%",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "6px 14px",
        padding: "0 60px",
        maxWidth: 820,
        margin: "0 auto",
      }}
    >
      {groups[activeIndex].words.map((word, index) => {
        const isActive = frame >= toFrame(word.start) && frame < toFrame(word.end);

        return (
          <span
            key={`${word.start}-${index}`}
            style={{
              fontSize: 44,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
              color: isActive ? themeColor : "#ffffff",
              textShadow: "0 4px 18px rgba(2, 4, 9, 0.85)",
            }}
          >
            {word.word}
          </span>
        );
      })}
    </div>
  );
};
