import assert from "node:assert/strict";
import { test } from "node:test";
import { hexToHsl, hslToHex, rotateHue } from "./palette";

test("round-trips a colour through HSL without drift", () => {
  for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#7c3aed", "#22c55e", "#f59e0b", "#000000", "#ffffff"]) {
    const { h, s, l } = hexToHsl(hex);
    assert.equal(hslToHex(h, s, l), hex, `${hex} did not survive the round trip`);
  }
});

test("expands three-digit hex", () => {
  assert.deepEqual(hexToHsl("#abc"), hexToHsl("#aabbcc"));
});

test("reports grey as having no saturation", () => {
  const { s } = hexToHsl("#808080");
  assert.equal(s, 0);
});

test("rotating hue moves the hue and leaves saturation and lightness alone", () => {
  const before = hexToHsl("#7c3aed");
  const after = hexToHsl(rotateHue("#7c3aed", 60));
  assert.equal(Math.round(after.h), Math.round((before.h + 60) % 360));
  assert.ok(Math.abs(after.s - before.s) < 0.01, "saturation drifted");
  assert.ok(Math.abs(after.l - before.l) < 0.01, "lightness drifted");
});

test("hue rotation wraps around the colour wheel", () => {
  assert.equal(rotateHue("#ff0000", 360), "#ff0000");
  assert.equal(Math.round(hexToHsl(rotateHue("#ff0000", -60)).h), 300);
});

test("rejects a colour it cannot parse", () => {
  assert.throws(() => hexToHsl("not a colour"), /Invalid hex colour/);
  assert.throws(() => hexToHsl("#12345"), /Invalid hex colour/);
});
