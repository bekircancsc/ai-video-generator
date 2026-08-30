import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_GROUP_SECONDS, MAX_WORDS_PER_GROUP, groupCaptionWords } from "./caption-groups";
import type { CaptionWord } from "../types/video";

function w(word: string, start: number, end: number): CaptionWord {
  return { word, start, end };
}

const texts = (groups: ReturnType<typeof groupCaptionWords>) =>
  groups.map((group) => group.words.map((word) => word.word));

test("no words produce no groups", () => {
  assert.deepEqual(groupCaptionWords([]), []);
});

test("a single word becomes one group spanning that word", () => {
  const groups = groupCaptionWords([w("hello", 0.1, 0.5)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].start, 0.1);
  assert.equal(groups[0].end, 0.5);
});

test("a group never holds more than the word cap", () => {
  const groups = groupCaptionWords([
    w("a", 0, 0.2),
    w("b", 0.2, 0.4),
    w("c", 0.4, 0.6),
    w("d", 0.6, 0.8),
    w("e", 0.8, 1),
    w("f", 1, 1.2),
  ]);
  assert.equal(MAX_WORDS_PER_GROUP, 4);
  assert.deepEqual(texts(groups), [["a", "b", "c", "d"], ["e", "f"]]);
});

test("a sentence ending closes the group early", () => {
  const groups = groupCaptionWords([w("Hello", 0, 0.3), w("there.", 0.3, 0.6), w("Next", 0.6, 0.9)]);
  assert.deepEqual(texts(groups), [["Hello", "there."], ["Next"]]);
});

test("punctuation still counts behind a closing quote", () => {
  const groups = groupCaptionWords([w('stop."', 0, 0.3), w("Go", 0.3, 0.6)]);
  assert.deepEqual(texts(groups), [['stop."'], ["Go"]]);
});

test("a group closes before it outstays the time budget", () => {
  assert.equal(MAX_GROUP_SECONDS, 2.5);
  const groups = groupCaptionWords([w("one", 0, 1.2), w("two", 1.2, 2.4), w("three", 2.4, 3.6)]);
  assert.deepEqual(texts(groups), [["one", "two"], ["three"]]);
});
