// Guards against drift between @outliers/core and the copies still inside the extension.
// TODO: once in-flight extension branches land, make the extension import @outliers/core and drop this.
import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const core = await loadTs("../src/index.ts");
const extCount = await loadTs("../../../apps/extension/src/shared/parse-count.ts");
const extCsv = await loadTs("../../../apps/extension/src/shared/export-csv.ts");
const extEmpty = await loadTs("../../../apps/extension/src/shared/empty-state-copy.ts");

test("parseCount matches the extension", () => {
  const inputs = ["0", "999", "1,234", "12.3K", "12.3k", "1.2M", "1M", "2.5B", " 96.3K ", "1 234", "1,2M", "1.234", "12..3K", "abc", "", null, undefined, 4200];
  for (const input of inputs) {
    const a = core.parseCount(input);
    const b = extCount.parseCount(input);
    assert.ok(Object.is(a, b), `parseCount(${JSON.stringify(input)}): core ${a} vs extension ${b}`);
  }
});

test("formatCount matches the extension", () => {
  const inputs = [0, 7, 999, 1000, 1049, 1050, 12_800, 96_300, 92_000, 99_950, 999_999, 1_000_000, 1_380_000, 6_000_000, 2_500_000_000];
  for (const n of inputs) assert.equal(core.formatCount(n), extCount.formatCount(n), `formatCount(${n})`);
});

test("CSV builders match the extension byte for byte", () => {
  const outliers = [
    { url: "https://www.instagram.com/sample.studio/reel/DEMO0009/", href: "/sample.studio/reel/DEMO0009/", views: 1_380_000, ratio: 1_380_000 / 18_400 },
    { url: "https://www.instagram.com/sample.studio/reel/DEMO0019/", href: "/sample.studio/reel/DEMO0019/", views: 312_000, ratio: 312_000 / 18_400 },
    { url: 'https://example.test/with,comma"quote', href: "", views: 92_000, ratio: 5 },
  ];
  const ctx = { profilePath: "https://www.instagram.com/sample.studio/", filterMode: "ratio5x", thresholdLabel: "92,000 views", exportedAt: "2026-10-04T12:00:00.000Z" };
  assert.equal(core.buildOutliersCsv(outliers, ctx), extCsv.buildOutliersCsv(outliers, ctx));

  const saved = outliers.map((r) => ({ ...r, savedAt: "2026-10-04T11:00:00.000Z", profilePath: ctx.profilePath }));
  const savedCtx = { exportedAt: ctx.exportedAt };
  assert.equal(core.buildSavedCsv(saved, savedCtx), extCsv.buildSavedCsv(saved, savedCtx));
});

test("empty-state copy matches the extension", () => {
  const inputs = [
    { filterMode: "ratio5x", followers: 648, threshold: 3240, minViews: null, scanLimit: 100 },
    { filterMode: "ratio5x", followers: 648, threshold: 3240, minViews: null, scanLimit: null },
    { filterMode: "ratio5x", followers: null, threshold: null, minViews: null, scanLimit: 12 },
    { filterMode: "minViews", followers: 648, threshold: 10000, minViews: 1000000, scanLimit: 1 },
    { filterMode: "minViews", followers: 648, threshold: null, minViews: null, scanLimit: null },
  ];
  for (const input of inputs) assert.deepEqual(core.buildEmptyStateCopy(input), extEmpty.buildEmptyStateCopy(input), JSON.stringify(input));
});
