import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCENES,
  MIN_SCENES,
  buildScriptPrompt,
  buildVideoPayloadJsonSchema,
  parseGeneratedScript,
  parseScriptJson,
} from "./script-schema";

/** A valid payload with `count` scenes, as JSON, for the parse tests. */
function payloadJson(count: number) {
  const scenes = Array.from({ length: count }, (_, index) => ({
    id: `scene-${index + 1}`,
    text: "Punchy line",
    subtext: "A shorter supporting line",
    narration: "This is what the voiceover says for this scene.",
    durationInFrames: 100,
    themeColor: "#7c3aed",
    keywords: ["one", "two"],
  }));

  return JSON.stringify({ title: "A Title", fps: 30, aspectRatio: "9:16", scenes });
}

test("an empty brief throws", () => {
  assert.throws(() => buildScriptPrompt({}), /topic or a niche/);
});

test("a topic-only brief names the topic", () => {
  const prompt = buildScriptPrompt({ topic: "Amor fati" });
  assert.match(prompt, /Amor fati/);
  assert.doesNotMatch(prompt, /niche/i);
});

test("a niche-only brief asks the model to pick the topic", () => {
  const prompt = buildScriptPrompt({ niche: "stoic philosophy" });
  assert.match(prompt, /stoic philosophy/);
  assert.match(prompt, /[Pp]ick one specific/);
});

test("a brief with both keeps the topic and adds the niche as context", () => {
  const prompt = buildScriptPrompt({ topic: "Amor fati", niche: "stoic philosophy" });
  assert.match(prompt, /Amor fati/);
  assert.match(prompt, /stoic philosophy/);
  assert.match(prompt, /tone/i);
});

test("an exact scene count is stated in the prompt", () => {
  assert.match(buildScriptPrompt({ topic: "x", sceneCount: 6 }), /exactly 6 scenes/);
});

test("without a count the prompt offers the range", () => {
  const prompt = buildScriptPrompt({ topic: "x" });
  assert.match(prompt, new RegExp(`between ${MIN_SCENES} and ${MAX_SCENES} scenes`));
});

test("the JSON schema pins an exact count when given one", () => {
  const schema = buildVideoPayloadJsonSchema(6) as any;
  assert.equal(schema.properties.scenes.minItems, 6);
  assert.equal(schema.properties.scenes.maxItems, 6);
});

test("the JSON schema spans the range when given no count", () => {
  const schema = buildVideoPayloadJsonSchema() as any;
  assert.equal(schema.properties.scenes.minItems, MIN_SCENES);
  assert.equal(schema.properties.scenes.maxItems, MAX_SCENES);
});

test("the JSON schema still requires narration on every scene", () => {
  const schema = buildVideoPayloadJsonSchema() as any;
  assert.ok(schema.properties.scenes.items.required.includes("narration"));
});

test("parseGeneratedScript accepts a matching exact count", () => {
  assert.equal(parseGeneratedScript(payloadJson(6), 6).scenes.length, 6);
});

test("parseGeneratedScript rejects a count that contradicts the brief", () => {
  assert.throws(() => parseGeneratedScript(payloadJson(5), 6), /6 scenes.*got 5/);
});

test("parseGeneratedScript accepts anything inside the range with no exact count", () => {
  assert.equal(parseGeneratedScript(payloadJson(8)).scenes.length, 8);
  assert.equal(parseGeneratedScript(payloadJson(3)).scenes.length, 3);
});

test("parseGeneratedScript rejects a count outside the range", () => {
  assert.throws(() => parseGeneratedScript(payloadJson(2)), /between 3 and 8/);
  assert.throws(() => parseGeneratedScript(payloadJson(9)), /between 3 and 8/);
});

test("parseScriptJson applies no count check at all", () => {
  assert.equal(parseScriptJson(payloadJson(12)).scenes.length, 12);
  assert.equal(parseScriptJson(payloadJson(1)).scenes.length, 1);
});

test("the JSON schema asks each scene for an imagePrompt", () => {
  const schema = buildVideoPayloadJsonSchema(4) as any;
  const scene = schema.properties.scenes.items;
  assert.ok(scene.properties.imagePrompt, "imagePrompt is missing from the scene schema");
  assert.ok(scene.required.includes("imagePrompt"));
});

test("the prompt tells the model what an imagePrompt is for", () => {
  const prompt = buildScriptPrompt({ topic: "The Future of AI" });
  assert.match(prompt, /imagePrompt/);
});

test("a payload without imagePrompt still validates, defaulting to empty", () => {
  const payload = parseScriptJson(
    JSON.stringify({
      title: "T",
      fps: 30,
      aspectRatio: "9:16",
      scenes: [
        { id: "s1", text: "a", subtext: "b", narration: "n", durationInFrames: 90, themeColor: "#7c3aed", keywords: [] },
        { id: "s2", text: "a", subtext: "b", narration: "n", durationInFrames: 90, themeColor: "#7c3aed", keywords: [] },
        { id: "s3", text: "a", subtext: "b", narration: "n", durationInFrames: 90, themeColor: "#7c3aed", keywords: [] },
      ],
    })
  );
  assert.equal(payload.scenes[0].imagePrompt, "");
  assert.equal(payload.scenes[0].imageSrc, undefined);
});
