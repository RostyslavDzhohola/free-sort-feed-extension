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

test("Min Views mode uses the chosen bar, defaulting to 10,000", () => {
  assert.equal(core.findOutliers(reels, { mode: "minViews", followers: 18_400, minViews: 200_000 }).outliers.length, 2);
  assert.equal(core.thresholdFor("minViews", 18_400, null), 10_000);
  assert.equal(core.thresholdFor("minViews", 18_400, 0), 10_000);
});

test("scan limit only considers the first N Reels in grid order", () => {
  const result = core.findOutliers(reels, { mode: "ratio5x", followers: 18_400, scanLimit: 3 });
  assert.equal(result.scannedCount, 3);
  assert.deepEqual(result.outliers.map((r) => r.views), [214_000]);
});

test("formatRatio and formatExact match the side panel", () => {
  assert.equal(core.formatRatio(312_000 / 18_400), "17.0×");
  assert.equal(core.formatExact(1_000_000), "1,000,000");
});
