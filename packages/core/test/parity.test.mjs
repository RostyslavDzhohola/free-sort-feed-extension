// Guards against drift between @outliers/core and the extension release live in the store.
// TODO: once the store version and main agree, make the extension import @outliers/core and drop this.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadTs } from "./load-ts.mjs";
import { extractStoreRelease } from "./store-release.mjs";
import { videoFixtures } from "./fixtures.mjs";

const core = await loadTs("../src/index.ts");
const release = extractStoreRelease();
const loadRelease = (file) => loadTs(pathToFileURL(join(release, file)).href);
const extCount = await loadRelease("shared/parse-count.ts");
const extVideos = await loadRelease("shared/videos.ts");
const extCsv = await loadRelease("shared/export-csv.ts");
const extEmpty = await loadRelease("shared/empty-state-copy.ts");
const extPlatform = await loadRelease("shared/platform.ts");

test("parseCount matches the extension", () => {
  const inputs = ["0", "999", "1,234", "12.3K", "12.3k", "1.2M", "1M", "2.5B", " 96.3K ", "1 234", "1,2M", "1.234", "1,234.5K", "1.234,5K", "12..3K", "abc", "", null, undefined, 4200];
  for (const input of inputs) {
    const a = core.parseCount(input);
    const b = extCount.parseCount(input);
    assert.ok(Object.is(a, b), `parseCount(${JSON.stringify(input)}): core ${a} vs extension ${b}`);
  }
});

test("formatters match the extension", () => {
  const counts = [0, 7, 999, 1000, 1049, 1050, 12_800, 96_300, 92_000, 99_950, 999_999, 1_000_000, 1_380_000, 6_000_000, 2_500_000_000, 0.4];
  for (const n of counts) {
    assert.equal(core.formatCount(n), extVideos.formatCount(n), `formatCount(${n})`);
    assert.equal(core.formatExact(n), extVideos.formatExact(n), `formatExact(${n})`);
  }
  for (const m of [0.004, 0.0123, 0.4, 1, 5, 17.04, 99.96, 100, 312.5]) assert.equal(core.formatMultiple(m), extVideos.formatMultiple(m), `formatMultiple(${m})`);
  for (const f of [0.0004, 0.012, 0.041, 0.1, 0.5]) assert.equal(core.formatPercent(f), extVideos.formatPercent(f), `formatPercent(${f})`);
  for (const s of [0, 9, 61, 3599.6]) assert.equal(core.formatDuration(s), extVideos.formatDuration(s), `formatDuration(${s})`);
  for (const key of extVideos.SORT_OPTIONS.map((o) => o.key)) {
    for (const value of [null, 0, 1, 1_500, 1_759_500_000]) {
      for (const hidden of [false, true]) {
        assert.equal(core.formatMetricPhrase(key, value, hidden), extVideos.formatMetricPhrase(key, value, hidden), `formatMetricPhrase(${key}, ${value}, ${hidden})`);
      }
    }
  }
});

test("sort options and labels match the extension", () => {
  assert.deepEqual(core.SORT_OPTIONS, extVideos.SORT_OPTIONS);
  assert.deepEqual(core.DEFAULT_VIEW, extVideos.DEFAULT_VIEW);
  assert.equal(core.OUTLIER_MULTIPLIER, extVideos.OUTLIER_MULTIPLIER);
  assert.equal(core.DEFAULT_MIN_VIEWS, extVideos.DEFAULT_MIN_VIEWS);
  for (const platform of ["instagram", "tiktok", null]) {
    assert.deepEqual(core.sortOptionsFor(platform), extVideos.sortOptionsFor(platform));
    for (const { key } of core.SORT_OPTIONS) assert.equal(core.resolveSortKey(key, platform), extVideos.resolveSortKey(key, platform));
    assert.equal(core.videoNoun(platform), extPlatform.videoNoun(platform));
    assert.equal(core.videoNoun(platform, false), extPlatform.videoNoun(platform, false));
    assert.equal(core.platformName(platform), extPlatform.platformName(platform));
  }
});

test("selectVideos filters and sorts like the extension, for every mode, key and direction", () => {
  for (const followers of [18_400, null]) {
    for (const filterMode of ["ratio5x", "minViews", "all"]) {
      for (const { key: sortKey } of core.SORT_OPTIONS) {
        for (const sortDir of ["desc", "asc"]) {
          const view = { filterMode, minViews: 100_000, sortKey, sortDir };
          const a = core.selectVideos(structuredClone(videoFixtures), view, followers).map((v) => v.url);
          const b = extVideos.selectVideos(structuredClone(videoFixtures), view, followers).map((v) => v.url);
          assert.deepEqual(a, b, JSON.stringify({ followers, ...view }));
        }
      }
    }
  }
  for (const v of videoFixtures) {
    for (const { key } of core.SORT_OPTIONS) assert.ok(Object.is(core.metricValue(v, key, 18_400), extVideos.metricValue(v, key, 18_400)), `${v.url} ${key}`);
  }
});

test("CSV builders match the extension byte for byte", () => {
  const ctx = {
    profilePath: "https://www.instagram.com/sample.studio/",
    filterMode: "ratio5x",
    thresholdLabel: "92,000 views",
    exportedAt: "2026-10-04T12:00:00.000Z",
    followers: 18_400,
    sortKey: "likes",
    sortDir: "asc",
  };
  assert.equal(core.buildOutliersCsv(videoFixtures, ctx), extCsv.buildOutliersCsv(videoFixtures, ctx));
  const bare = { profilePath: null, filterMode: "all", thresholdLabel: "All Reels", exportedAt: ctx.exportedAt };
  assert.equal(core.buildOutliersCsv(videoFixtures, bare), extCsv.buildOutliersCsv(videoFixtures, bare));

  const saved = videoFixtures.map((r) => ({ ...r, savedAt: "2026-10-04T11:00:00.000Z", profilePath: ctx.profilePath }));
  const savedCtx = { exportedAt: ctx.exportedAt };
  assert.equal(core.buildSavedCsv(saved, savedCtx), extCsv.buildSavedCsv(saved, savedCtx));
});

test("empty-state copy matches the extension", () => {
  const inputs = [];
  for (const platform of ["instagram", "tiktok", undefined]) {
    for (const filterMode of ["ratio5x", "minViews", "all"]) {
      inputs.push(
        { platform, filterMode, followers: 648, threshold: 3240, minViews: null, scanLimit: 100, scannedCount: 100 },
        { platform, filterMode, followers: 648, threshold: 3240, minViews: null, scanLimit: 100, scannedCount: 36 },
        { platform, filterMode, followers: 648, threshold: 3240, minViews: null, scanLimit: null, scannedCount: 120 },
        { platform, filterMode, followers: null, threshold: null, minViews: null, scanLimit: 12 },
        { platform, filterMode, followers: 648, threshold: 10000, minViews: 1000000, scanLimit: 1, scannedCount: 1 },
      );
    }
  }
  for (const input of inputs) assert.deepEqual(core.buildEmptyStateCopy(input), extEmpty.buildEmptyStateCopy(input), JSON.stringify(input));
});
