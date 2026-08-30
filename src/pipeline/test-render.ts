import { renderVideo } from "./render";

const mockPayload = {
  title: "Offline Render Smoke Test",
  fps: 30,
  aspectRatio: "9:16",
  scenes: [
    {
      id: "scene-1",
      text: "Static render check",
      subtext: "Validating scene timing and output generation.",
      narration: "This is the first scene of the offline render smoke test.",
      durationInFrames: 60,
      themeColor: "#7c3aed",
      keywords: ["render", "validation", "AI"],
    },
    {
      id: "scene-2",
      text: "Everything is in sync",
      subtext: "Frame cadence and transitions are working as expected.",
      narration: "Frame cadence and transitions are being checked here.",
      durationInFrames: 60,
      themeColor: "#22c55e",
      keywords: ["sync", "frame", "check"],
    },
    {
      id: "scene-3",
      text: "Output ready",
      subtext: "The final video asset is prepared for review.",
      narration: "The final asset is ready for review.",
      durationInFrames: 60,
      themeColor: "#38bdf8",
      keywords: ["output", "review", "ready"],
    },
  ],
};

const run = async () => {
  console.log("Running offline render smoke test...");
  const result = await renderVideo("Smoke test", mockPayload);
  console.log(`Smoke test complete: ${result.outputLocation}`);
};

run().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exitCode = 1;
});
