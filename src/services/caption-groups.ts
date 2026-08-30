import type { CaptionWord } from "../types/video";

/**
 * Groups transcribed words into the chunks drawn on screen.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

/** Most words shown at once, so a chunk stays readable at a glance. */
export const MAX_WORDS_PER_GROUP = 4;

/** Longest a chunk may hold the screen before the next one takes over. */
export const MAX_GROUP_SECONDS = 2.5;

export type CaptionGroup = {
  words: CaptionWord[];
  start: number;
  end: number;
};

/** True when a word closes a sentence, allowing for a trailing quote or bracket. */
function endsSentence(word: string): boolean {
  return /[.!?]["')\]]*$/.test(word.trim());
}

export function groupCaptionWords(words: CaptionWord[]): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }

    groups.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
  };

  for (const word of words) {
    // A word that would stretch the chunk past its budget starts a new one.
    if (current.length > 0 && word.end - current[0].start > MAX_GROUP_SECONDS) {
      flush();
    }

    current.push(word);

    if (current.length >= MAX_WORDS_PER_GROUP || endsSentence(word.word)) {
      flush();
    }
  }

  flush();

  return groups;
}
