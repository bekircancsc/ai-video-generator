# Fonts

Inter, vendored so a render never depends on reaching a font CDN. Every other
asset directory under `public/` is generated and gitignored; this one is
checked in, because it is source.

| File | Bytes | Unicode range |
|---|---|---|
| `inter-latin.woff2` | 48256 | `U+0000-00FF`, `U+0131`, `U+0152-0153`, `U+02BB-02BC`, `U+02C6`, `U+02DA`, `U+02DC`, `U+0304`, `U+0308`, `U+0329`, `U+2000-206F`, `U+20AC`, `U+2122`, `U+2191`, `U+2193`, `U+2212`, `U+2215`, `U+FEFF`, `U+FFFD` |
| `inter-latin-ext.woff2` | 85068 | `U+0100-02BA`, `U+02BD-02C5`, `U+02C7-02CC`, `U+02CE-02D7`, `U+02DD-02FF`, `U+0304`, `U+0308`, `U+0329`, `U+1D00-1DBF`, `U+1E00-1E9F`, `U+1EF2-1EFF`, `U+2020`, `U+20A0-20AB`, `U+20AD-20C0`, `U+2113`, `U+2C60-2C7F`, `U+A720-A7FF` |

Both are variable across `font-weight: 100 900`, so the 500, 700 and 800 the
components ask for come out of one file each with no extra download.

The two are one family split by `unicode-range`, exactly as Google's own CSS
splits it. Both are needed for Turkish: dotless `ı` (U+0131) is in the latin
subset, while `ğ` (U+011F), `ş` (U+015F) and `İ` (U+0130) are in latin-ext.

## Source

Downloaded from the URLs in Google Fonts' CSS for `Inter:wght@100..900`:

    https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2
    https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2

To refresh them, re-read that CSS with a modern browser User-Agent (Google
serves `woff2` only to browsers that support it) and take the `latin` and
`latin-ext` blocks:

    curl -H "User-Agent: Mozilla/5.0 ... Chrome/120.0.0.0 ..." \
      "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap"

If the ranges above change, update `src/fonts.ts` to match — it repeats them,
because the `FontFace` API takes them as a descriptor rather than reading CSS.

## Licence

Inter is licensed under the SIL Open Font License 1.1, in `OFL.txt`.
