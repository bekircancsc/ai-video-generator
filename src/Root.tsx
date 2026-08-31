import React from "react";
import { Composition, registerRoot } from "remotion";
import { VideoRoot } from "./VideoRoot";
import { timelineFrames } from "./services/timing";
import type { VideoPayload } from "./types/video";

const defaultVideo: VideoPayload = {
  title: "The Future of AI",
  fps: 30,
  aspectRatio: "9:16",
  scenes: [
    {
      id: "scene-1",
      text: "The Future of AI",
      subtext: "Smarter systems, bigger ideas, faster change.",
      narration: "Artificial intelligence is moving faster than anyone predicted, and the pace is still climbing.",
      durationInFrames: 90,
      themeColor: "#7c3aed",
      keywords: ["AI", "automation", "future"],
      imagePrompt: "A dense city skyline at dawn, data light tracing across the glass towers",
    },
    {
      id: "scene-2",
      text: "Ideas become tools",
      subtext: "Creative workflows are moving from imagination to execution.",
      narration: "Ideas that used to sit in a notebook now turn into working tools in a single afternoon.",
      durationInFrames: 90,
      themeColor: "#22c55e",
      keywords: ["idea", "creative", "execution"],
      imagePrompt: "A cluttered desk where a sketched notebook page lifts into a glowing prototype",
    },
    {
      id: "scene-3",
      text: "Human + AI",
      subtext: "Together, we build what no single mind can do alone.",
      narration: "The real advantage is not the machine alone. It is what people build with it.",
      durationInFrames: 90,
      themeColor: "#38bdf8",
      keywords: ["human", "AI", "collaboration"],
      imagePrompt: "A person's hands and a robotic arm building the same structure together",
    },
  ],
};

const getDurationInFrames = (video: VideoPayload) => {
  return timelineFrames(video.scenes.map((scene) => scene.durationInFrames));
};

const getDimensions = (aspectRatio: string) => {
  const [widthRatio, heightRatio] = aspectRatio.split(":").map(Number);

  if (!widthRatio || !heightRatio) {
    return { width: 1080, height: 1920 };
  }

  const baseHeight = 1920;
  const width = Math.round((baseHeight * widthRatio) / heightRatio);

  return {
    width,
    height: baseHeight,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AI-Video"
        component={VideoRoot}
        durationInFrames={getDurationInFrames(defaultVideo)}
        fps={defaultVideo.fps}
        width={getDimensions(defaultVideo.aspectRatio).width}
        height={getDimensions(defaultVideo.aspectRatio).height}
        defaultProps={{ video: defaultVideo }}
        calculateMetadata={({ props }) => {
          const dimensions = getDimensions(props.video.aspectRatio);

          return {
            durationInFrames: getDurationInFrames(props.video),
            fps: props.video.fps,
            width: dimensions.width,
            height: dimensions.height,
          };
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);

export default RemotionRoot;
