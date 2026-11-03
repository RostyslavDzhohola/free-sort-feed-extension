import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";
import { loadExtensionReport } from "./extension-report.mjs";
import { videoFixtures } from "./fixtures.mjs";

const core = await loadTs("../src/index.ts");
const ext = await loadExtensionReport();

test("threshold and scan-limit labels match the side panel", () => {
  for (const platform of ["instagram", "tiktok", null]) {
    ext.setContext(platform, null);
    for (const mode of ["ratio5x", "minViews", "all"]) {
      for (const [followers, minViews] of [[659, null], [659, 250_000], [null, null], [null, 1_000]]) {
        assert.equal(core.thresholdLabel(mode, followers, minViews, platform), ext.getThresholdLabel(mode, followers, minViews), JSON.stringify({ platform, mode, followers, minViews }));
      }
    }
    for (const limit of [null, 1, 100, 975]) assert.equal(core.formatScanLimit(limit, platform), ext.formatScanLimitValue(limit), `${platform} ${limit}`);
  }
});

test("the Copy report matches the side panel for every sort", () => {
  for (const platform of ["instagram", "tiktok"]) {
    ext.setContext(platform, { platform, handle: "sample.studio" });
    for (const { key: sortKey } of core.SORT_OPTIONS) {
      for (const sortDir of ["desc", "asc"]) {
        const state = { platform, followers: 18_400, sortKey, sortDir, activeThresholdLabel: "92,000 views", outliers: videoFixtures };
        assert.equal(core.buildOutliersPlainText(state, "sample.studio"), ext.buildOutliersPlainText(state), `${platform} ${sortKey} ${sortDir}`);
        assert.equal(core.buildOutliersPlainText(state, "sample.studio", 2), ext.buildOutliersPlainText(state, 2));
      }
    }
  }
  ext.setContext("instagram", null);
  const noProfile = { followers: null, activeThresholdLabel: "All Reels", outliers: videoFixtures.slice(0, 2) };
  assert.equal(core.buildOutliersPlainText(noProfile, null), ext.buildOutliersPlainText(noProfile));
});

test("the page grid's header line reads like the extension's", () => {
  const state = { platform: "instagram", followers: 659, sortKey: "views", sortDir: "desc", activeThresholdLabel: "3,295 views", outliers: videoFixtures.slice(0, 6), scannedCount: 36 };
  assert.equal(core.pageGridMeta(state), "6 of 36 Reels • 3,295 views • sorted by views ↓");
  assert.equal(core.pageGridMeta({ ...state, sortKey: "multiple", sortDir: "asc" }), "6 of 36 Reels • 3,295 views • sorted by views ÷ followers ↑");
});
