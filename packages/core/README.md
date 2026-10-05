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

TODO: once in-flight extension branches have landed, make the extension import `@outliers/core` and delete its copies. Until then, `test/parity.test.mjs` and `test/sliders.test.mjs` load the extension source and fail if the two drift apart. If you change one, change the other.

```bash
pnpm --filter @outliers/core test
pnpm --filter @outliers/core typecheck
pnpm --filter @outliers/core lint
```
