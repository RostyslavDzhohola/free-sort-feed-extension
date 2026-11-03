# @outliers/core

Pure Outliers logic with no DOM and no Chrome APIs, mirroring the extension release in the store (v1.1.1):

- `parseCount` and the formatters (`formatCount`, `formatExact`, `formatMultiple`, `formatMetricPhrase`, …)
- the view: `selectVideos` (Show: 5× Outliers, Min Views or All; Sort by any metric, highest or lowest first), `metricValue`, `engagementRate`, `viewsMultiple`, `SORT_OPTIONS` and `getThreshold` (`views >= followers × 5`, or `views >= minViews`)
- `findOutliers`, the website's wrapper: the first `scanLimit` Reels in grid order, run through `selectVideos`
- the side panel's wording: threshold and scan-limit labels, the Copy report, the page grid's header line
- the slider curves: scan limit (1 → 100 → 150 → 200 → 500 → 975 → All) and Min Views (log scale 1K–1M, snapping at 1K/10K/100K/1M)
- the CSV layouts for results and the Library, and the empty-state copy

It ships TypeScript source (`exports` → `src/index.ts`). Astro/Vite and esbuild compile it where it's used, so there's no build step.

## Status

The website uses it today. The extension still has its own copies in `apps/extension/src/shared/` and `apps/extension/src/sidepanel.ts`.

The website demos the version that's live in the Chrome Web Store, so core mirrors that release (`STORE_RELEASE` in `test/store-release.mjs`, now `v1.1.1`), not the extension's working tree, which can be a version ahead. `test/parity.test.mjs`, `test/report.test.mjs` and `test/sliders.test.mjs` extract that tag's source with `git archive` and fail if core drifts from it, so the tag must be in your clone (in a shallow one: `git fetch --depth=1 origin tag v1.1.1`). When a new version goes live in the store, bump `STORE_RELEASE`, port its changes here and swap the website's panel replica together.

TODO: once the store version and main agree, make the extension import `@outliers/core` and delete its copies.

```bash
pnpm --filter @outliers/core test
pnpm --filter @outliers/core typecheck
pnpm --filter @outliers/core lint
```
