import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";
import { loadExtensionSliders } from "./extension-sliders.mjs";

const core = await loadTs("../src/index.ts");
const ext = loadExtensionSliders();
const positions = Array.from({ length: 1001 }, (_, i) => i);

test("scan-limit slider matches the extension at every position and limit", () => {
  assert.deepEqual(positions.map(core.sliderPositionToScanLimit), positions.map(ext.sliderPositionToScanLimit));
  for (const limit of [null, ...Array.from({ length: 975 }, (_, i) => i + 1)]) {
    assert.equal(core.scanLimitToSliderPosition(limit), ext.scanLimitToSliderPosition(limit), `limit ${limit}`);
  }
});

test("min-views slider matches the extension at every position", () => {
  assert.deepEqual(positions.map(core.sliderPositionToMinViews), positions.map(ext.sliderPositionToMinViews));
  for (const value of [1_000, 2_500, 10_000, 92_000, 100_000, 250_000, 1_000_000]) {
    assert.equal(core.minViewsToSliderPosition(value), ext.minViewsToSliderPosition(value), `value ${value}`);
  }
});

test("slider anchors land where the side panel shows them", () => {
  assert.equal(core.scanLimitToSliderPosition(100), 200);
  assert.equal(core.sliderPositionToScanLimit(1000), null);
  assert.equal(core.formatScanLimit(100), "100 reels");
  assert.equal(core.formatScanLimit(null), "All reels");
  for (const marker of [1_000, 10_000, 100_000, 1_000_000]) {
    assert.equal(core.sliderPositionToMinViews(core.minViewsToSliderPosition(marker)), marker);
  }
});
