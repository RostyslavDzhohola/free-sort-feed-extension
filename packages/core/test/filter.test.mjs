import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const core = await loadTs("../src/index.ts");

const reels = [12_800, 214_000, 91_999, 92_000, NaN, 1_380_000, 5_100].map((views, i) => ({ url: `r${i}`, views }));

test("5× mode keeps views >= followers × 5, ranked by views", () => {
  const result = core.findOutliers(reels, { mode: "ratio5x", followers: 18_400 });
  assert.equal(result.threshold, 92_000);
  assert.equal(result.thresholdLabel, "92,000 views");
  assert.deepEqual(result.outliers.map((r) => r.views), [1_380_000, 214_000, 92_000]);
  assert.equal(result.outliers[0].ratio, 1_380_000 / 18_400);
  assert.equal(result.scannedCount, reels.length);
});

test("5× mode shows nothing without a follower count", () => {
  const result = core.findOutliers(reels, { mode: "ratio5x", followers: null });
  assert.equal(result.threshold, null);
  assert.equal(result.thresholdLabel, "5× follower count");
  assert.equal(result.outliers.length, 0);
});

test("Min Views mode uses the chosen bar, defaulting to 10,000", () => {
  assert.equal(core.findOutliers(reels, { mode: "minViews", followers: 18_400, minViews: 200_000 }).outliers.length, 2);
  assert.equal(core.getThreshold("minViews", 18_400, null), 10_000);
  assert.equal(core.getThreshold("minViews", 18_400, 0), 10_000);
});

test("All lists every scanned Reel, in the chosen order", () => {
  const all = core.findOutliers(reels, { mode: "all", followers: 18_400, scanLimit: 4 });
  assert.equal(all.threshold, null);
  assert.equal(all.thresholdLabel, "All Reels");
  assert.deepEqual(all.outliers.map((r) => r.views), [214_000, 92_000, 91_999, 12_800]);
  const lowest = core.findOutliers(reels, { mode: "all", followers: 18_400, scanLimit: 4, sortDir: "asc" });
  assert.deepEqual(lowest.outliers.map((r) => r.views), [12_800, 91_999, 92_000, 214_000]);
});

test("a TikTok-only sort key falls back to views on Instagram", () => {
  const result = core.findOutliers(reels, { mode: "ratio5x", followers: 18_400, sortKey: "shares" });
  assert.equal(result.sortKey, "views");
  assert.deepEqual(result.outliers.map((r) => r.views), [1_380_000, 214_000, 92_000]);
});

test("scan limit only considers the first N Reels in grid order", () => {
  const result = core.findOutliers(reels, { mode: "ratio5x", followers: 18_400, scanLimit: 3 });
  assert.equal(result.scannedCount, 3);
  assert.deepEqual(result.outliers.map((r) => r.views), [214_000]);
});

test("formatMultiple and formatExact match the side panel", () => {
  assert.equal(core.formatMultiple(312_000 / 18_400), "17.0×");
  assert.equal(core.formatMultiple(1_380_000 / 659), "2094×");
  assert.equal(core.formatMultiple(414 / 659), "0.63×");
  assert.equal(core.formatExact(1_000_000), "1,000,000");
});
