# Win celebration assets

Every web, iOS, and Android build uses the same three committed SVG illustrations in `src/assets/celebrations/`: a chip stack, a gold trophy, and a chip with confetti. `src/net/useWinCelebration.ts` imports each one explicitly. There is no asset glob or private-build switch, so adding files to the ignored `src/assets/wins/` directory cannot add them to a celebration or the client bundle.

## Provenance

These illustrations were authored for this repository as editable SVG geometry. The chip stack replaces the previously committed `src/assets/wins/placeholder-chips.svg`, retaining its felt, gold, green, and red palette. The trophy and confetti illustration are original geometric compositions in the same palette. No private images were viewed, copied, traced, or embedded. The files contain no external artwork, logos, people, fonts, scripts, external links, or raster payloads.

The legacy image glob described in `CLAUDE.md` and the Distribution note in `docs/native-app-plan.md` has been removed. This document describes the current build behavior and asset collection.

## Replacing or extending the collection

Put reviewed illustrations in `src/assets/celebrations/`, import them by filename in `src/net/useWinCelebration.ts`, and add them to its `images` array. Prefer self-contained SVG geometry in the existing felt/gold style, with a `0 0 320 320` viewBox. The celebration dialog already renders the award text and uses an empty image `alt`, so the artwork should stay decorative and contain no award amount.

Keep `src/assets/wins/` ignored and unreferenced. Never use it as a glob source, Vite public directory, or native resource source. When checking exclusion, use a synthetic harmless marker file rather than opening or copying existing private images. Inspect the built bundle to verify that the marker and legacy asset references are absent. Capacitor packages the rebuilt `dist/`; run `npm run build` before syncing either native platform to replace any previously copied bundle.

Image selection still avoids repeating the previous illustration. The ten-second dismissal timer, pot/undo handling, dialog controls, and win haptics are unchanged.
