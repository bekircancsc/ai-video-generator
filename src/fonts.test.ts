import assert from "node:assert/strict";
import test from "node:test";
import { FONT_FAMILY } from "./fonts";

test("the family stack asks for Inter first", () => {
  assert.ok(FONT_FAMILY.startsWith('"Inter"'), FONT_FAMILY);
});

test("the family stack ends in a generic family", () => {
  // The whole point of the stack is the failure path: if the woff2 never
  // loads, the text still has to be drawn in something. A stack of named
  // families only would leave that to the browser's default — the serif this
  // change exists to get rid of.
  const last = FONT_FAMILY.split(",").pop()?.trim();

  assert.equal(last, "sans-serif");
});

test("importing the module loads no font", () => {
  // Guards the constraint that makes this file importable at all: `FontFace`
  // does not exist in Node, so any import-time load would have thrown above,
  // and `loadFonts` must stay something the browser entry calls explicitly.
  assert.equal(typeof globalThis.FontFace, "undefined");
});
