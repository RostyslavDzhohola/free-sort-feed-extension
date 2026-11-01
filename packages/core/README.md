# @outliers/core

Pure Outliers logic with no DOM and no Chrome APIs:

- `parseCount` / `formatCount` / `formatExact` / `formatRatio`
- the outlier rule: `thresholdFor`, `findOutliers` (`views >= followers × 5` or `views >= minViews`, ranked by views, `ratio = views / followers`)
- the side panel's slider curves: scan limit (1 → 100 → 150 → 200 → 500 → 975 → All) and Min Views (log scale 1K–1M, snapping at 1K/10K/100K/1M)
- the CSV layouts for results and the Library
- the "No Reels qualified" empty-state copy

It ships TypeScript source (`exports` → `src/index.ts`). Astro/Vite and esbuild compile it where it's used, so there's no build step.

## Status

The website uses it today. The extension still has its own copies in `apps/extension/src/shared/` and `apps/extension/src/sidepanel.ts`.

The website demos the version that's live in the Chrome Web Store, so core mirrors that release (`STORE_RELEASE` in `test/store-release.mjs`, now `v1.0.8`), not the extension's working tree, which can be a version ahead. `test/parity.test.mjs` and `test/sliders.test.mjs` extract that tag's source with `git archive` and fail if core drifts from it, so the tag must be in your clone (in a shallow one: `git fetch --depth=1 origin tag v1.0.8`). When a new version goes live in the store, bump `STORE_RELEASE`, port its changes here and swap the website's panel replica together.

TODO: once the store version and main agree, make the extension import `@outliers/core` and delete its copies.

```bash
pnpm --filter @outliers/core test
pnpm --filter @outliers/core typecheck
pnpm --filter @outliers/core lint
```
