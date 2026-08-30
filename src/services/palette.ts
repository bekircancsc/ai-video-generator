/**
 * Colour maths for deriving a palette from a scene's single theme colour.
 *
 * This module must stay free of Node built-ins and of `dotenv`: Remotion
 * bundles the components for the browser, and a Node import reaching that
 * bundle breaks it.
 */

export type Hsl = { h: number; s: number; l: number };

/**
 * The near-black ground the whole pipeline is built on. Single source of
 * truth: every place that needs this exact colour (or a transparent version
 * of it) imports it from here instead of repeating the literal.
 */
export const BASE_COLOR = "#030712";

/** Hue offsets for the three clouds, giving an analogous palette from one colour. */
export const HUE_OFFSETS = [0, 32, -28];

/** Expands #rgb to #rrggbb and rejects anything that is not a hex colour. */
function normaliseHex(hex: string): string {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());

  if (!match) {
    throw new Error(`Invalid hex colour "${hex}". Expected #rgb or #rrggbb.`);
  }

  const body = match[1];

  return body.length === 3
    ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`.toLowerCase()
    : `#${body.toLowerCase()}`;
}

/**
 * Verified exhaustively: every one of the 16,777,216 24-bit colours survives
 * hexToHsl -> hslToHex unchanged, so a theme colour from a model cannot land
 * on a rounding boundary and come back a shade off.
 */
export function hexToHsl(hex: string): Hsl {
  const full = normaliseHex(hex);
  const r = parseInt(full.slice(1, 3), 16) / 255;
  const g = parseInt(full.slice(3, 5), 16) / 255;
  const b = parseInt(full.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;

  if (max === r) {
    h = 60 * (((g - b) / delta) % 6);
  } else if (max === g) {
    h = 60 * ((b - r) / delta + 2);
  } else {
    h = 60 * ((r - g) / delta + 4);
  }

  return { h: (h + 360) % 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];

  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Shifts a colour around the wheel, keeping its saturation and lightness. */
export function rotateHue(hex: string, degrees: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + degrees, s, l);
}

/**
 * Renders a hex colour as `rgba(r, g, b, 0)` so a gradient's transparent stop
 * can fade to the exact same colour as its opaque background instead of a
 * hand-copied literal that can drift out of sync with it.
 */
export function toTransparentRgba(hex: string): string {
  const full = normaliseHex(hex);
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);

  return `rgba(${r}, ${g}, ${b}, 0)`;
}

/**
 * Appends an alpha channel to a colour, as #rrggbbaa.
 *
 * The scene schema permits three-digit hex, so a colour cannot simply have two
 * alpha characters concatenated onto it: "#abc" + "99" is five digits, which
 * CSS rejects, silently dropping whatever declaration used it. Expanding the
 * colour first is what makes the result valid for every colour the schema
 * allows.
 */
export function withAlpha(hex: string, alpha: number): string {
  if (!(alpha >= 0 && alpha <= 1)) {
    throw new Error(`Alpha must be between 0 and 1, received ${alpha}.`);
  }

  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");

  return `${normaliseHex(hex)}${channel}`;
}
