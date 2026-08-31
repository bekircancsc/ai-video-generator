import { continueRender, delayRender, staticFile } from "remotion";

/**
 * The typeface, embedded rather than borrowed.
 *
 * Without this the components inherit Chromium's default serif, which is Times
 * New Roman on Windows and DejaVu Serif on a Linux render box — so the same
 * payload produced a visibly different video depending on where it rendered.
 *
 * This module must stay free of Node built-ins, like `src/services/*`:
 * Remotion bundles it for the browser. It must also stay free of *import-time*
 * side effects, for the opposite reason — `FontFace` exists only in the
 * browser, so a module that loaded on import could not be imported by a test.
 */

/**
 * Two files, one family, split by `unicode-range` exactly as Google's own CSS
 * splits it. Turkish needs both: dotless `ı` is in the latin subset, while
 * `ğ ş İ` are in latin-ext.
 *
 * The ranges are repeated here because the `FontFace` API takes them as a
 * descriptor; they are not read from the woff2. `public/fonts/README.md` says
 * where they came from.
 */
const SUBSETS = [
  {
    file: "fonts/inter-latin.woff2",
    unicodeRange:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, " +
      "U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, " +
      "U+2212, U+2215, U+FEFF, U+FFFD",
  },
  {
    file: "fonts/inter-latin-ext.woff2",
    unicodeRange:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, " +
      "U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, " +
      "U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  },
] as const;

/**
 * The stack every composition sets on its root. The generic family at the end
 * is the failure path: if a face will not load, the frame is still drawn.
 */
export const FONT_FAMILY = '"Inter", system-ui, sans-serif';

/**
 * Registers both faces, holding the render until they are ready.
 *
 * Called once, at module scope in `src/Root.tsx`. Calling it twice would be
 * harmless — `document.fonts` is a set — but there is no reason to.
 *
 * Every path continues its handle, including the failure path. An abandoned
 * `delayRender` handle does not degrade the render, it hangs it forever, which
 * is a far worse outcome than a frame set in the fallback family.
 */
export function loadFonts(): void {
  for (const { file, unicodeRange } of SUBSETS) {
    const handle = delayRender(`Loading ${file}`);

    const face = new FontFace("Inter", `url(${staticFile(file)}) format("woff2")`, {
      weight: "100 900",
      style: "normal",
      // A `FontFace` descriptor, not CSS. Under the default `auto` Chromium
      // may paint a frame in the fallback face while the woff2 is still
      // decoding, which is the exact nondeterminism this module removes.
      display: "block",
      unicodeRange,
    });

    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
      })
      .catch((error: unknown) => {
        console.warn(`[fonts] falling back (${file}: ${String(error)})`);
      })
      // One call site rather than one per branch, so a later edit cannot
      // continue the handle on success and forget it on failure.
      .finally(() => {
        continueRender(handle);
      });
  }
}
