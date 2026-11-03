import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./load-ts.mjs";

const engine = await loadTs("../src/lib/demo-engine.ts");
const sample = JSON.parse(readFileSync(new URL("../src/data/demo/sample.studio/snapshot.json", import.meta.url), "utf8"));
const { reels, followers } = sample;

const scan = (settings) => engine.finishScan(engine.startScan(engine.initialState(settings), reels, followers), reels, followers);
const update = (state, patch) => engine.updateSettings(state, patch, reels, followers);
const views = (state) => state.result.outliers.map((r) => r.views);

test("a full 5× scan of the sample ranks 6 of 36 Reels by views", () => {
  const done = scan(engine.DEFAULT_SETTINGS);
  assert.equal(done.phase, "done");
  assert.equal(done.collected, 36);
  assert.deepEqual(views(done), [1_380_000, 520_000, 312_000, 214_000, 141_000, 96_300]);
  assert.deepEqual(engine.activeThreshold(done.settings, followers), { title: "Active threshold", label: "92,000 views" });
  assert.equal(engine.resultsTitle(done.settings.mode), "Outliers");
  assert.equal(engine.resultsMeta(done.result.outliers.length, done.collected), "— 6 of 36 Reels");
  assert.equal(engine.gridMeta(done, followers), "6 of 36 Reels • 92,000 views • sorted by views ↓");
});

test("the scan stops at exactly the scan limit, like 1.1", () => {
  assert.equal(scan({ ...engine.DEFAULT_SETTINGS, scanLimit: 1 }).collected, 1);
  assert.equal(scan({ ...engine.DEFAULT_SETTINGS, scanLimit: 13 }).collected, 13);
  assert.equal(scan({ ...engine.DEFAULT_SETTINGS, scanLimit: 100 }).collected, 36, "a limit past the grid ends at its last Reel");
  assert.equal(scan({ ...engine.DEFAULT_SETTINGS, scanLimit: null }).collected, 36);
});

test("results fill in live while scanning, and Stop finalizes what's collected", () => {
  let state = engine.startScan(engine.initialState(), reels, followers);
  assert.equal(state.phase, "scanning");
  assert.equal(state.result.outliers.length, 0);
  state = engine.collectBatch(state, reels, followers);
  assert.equal(state.collected, engine.BATCH_SIZE);
  assert.equal(state.phase, "scanning");
  assert.deepEqual(views(state), [1_380_000, 214_000]);
  state = engine.stopScan(state);
  assert.equal(state.phase, "done");
  assert.equal(state.collected, 12);
});

test("Show and Sort by re-rank the scanned Reels at once, during and after a scan", () => {
  let state = scan(engine.DEFAULT_SETTINGS);
  state = update(state, { mode: "minViews", minViews: 300_000 });
  assert.deepEqual(views(state), [1_380_000, 520_000, 312_000]);
  state = update(state, { sortDir: "asc" });
  assert.deepEqual(views(state), [312_000, 520_000, 1_380_000]);
  state = update(state, { mode: "all" });
  assert.equal(state.result.outliers.length, 36);
  assert.equal(engine.resultsTitle(state.settings.mode), "Reels");
  assert.deepEqual(engine.activeThreshold(state.settings, followers), { title: "Showing", label: "All Reels" });
  assert.equal(engine.hasPendingChanges(state), false, "no rescan needed");

  let live = engine.collectBatch(engine.startScan(engine.initialState(), reels, followers), reels, followers);
  live = update(live, { mode: "all", sortKey: "multiple", sortDir: "asc" });
  assert.equal(live.phase, "scanning");
  assert.equal(live.result.outliers.length, 12);
  assert.equal(live.result.sortKey, "multiple");
  live = engine.collectBatch(live, reels, followers);
  assert.equal(live.result.outliers.length, 24, "later batches keep the new view");
});

test("the scan limit locks while scanning, and after a scan waits for Reset → Run", () => {
  const scanning = engine.startScan(engine.initialState(), reels, followers);
  const locked = update(scanning, { scanLimit: 12 });
  assert.equal(locked.settings.scanLimit, 100);
  assert.equal(locked.scannedLimit, 100);

  let state = scan(engine.DEFAULT_SETTINGS);
  state = update(state, { scanLimit: 12 });
  assert.equal(state.collected, 36, "results keep the scan they came from");
  assert.equal(engine.hasPendingChanges(state), true);
  state = engine.resetScan(state);
  assert.equal(state.phase, "idle");
  assert.equal(state.result, null);
  state = engine.finishScan(engine.startScan(state, reels, followers), reels, followers);
  assert.equal(state.collected, 12);
  assert.equal(engine.hasPendingChanges(state), false);

  const idle = update(engine.initialState(), { scanLimit: 200 });
  assert.equal(idle.scannedLimit, 200);
});

test("progress text matches the extension's wording", () => {
  assert.equal(engine.progressText(24, 100), "Scanning… 24 / 100 Reels");
  assert.equal(engine.progressText(24, null), "Scanning… 24 Reels found");
});

test("empty results use the extension's copy, with the limit hint only when the limit was reached", () => {
  const empty = scan({ ...engine.DEFAULT_SETTINGS, mode: "minViews", minViews: 2_000_000, scanLimit: 1 });
  const copy = engine.emptyState(empty, followers);
  assert.equal(copy.title, "No Reels hit your minimum views filter.");
  assert.equal(copy.detail, "Current minimum: 2,000,000 views. Lower Min Views, or pick All to see every Reel sorted. Scanned the first 1 Reels only.");
  const short = scan({ ...engine.DEFAULT_SETTINGS, mode: "minViews", minViews: 2_000_000, scanLimit: 100 });
  assert.ok(!engine.emptyState(short, followers).detail.includes("Scanned"), "no hint when the grid ran out first");
  const stopped = engine.stopScan(engine.collectBatch(engine.startScan(engine.initialState({ ...engine.DEFAULT_SETTINGS, mode: "minViews", minViews: 2_000_000 }), reels, followers), reels, followers));
  assert.ok(!engine.emptyState(stopped, followers).detail.includes("Scanned"), "no hint after an early Stop");
});

test("the plain-text report matches the extension's Copy format", () => {
  const done = scan({ ...engine.DEFAULT_SETTINGS, scanLimit: 12 });
  assert.equal(
    engine.plainTextReport(done, "sample.studio", followers),
    "Outliers report for @sample.studio on Instagram (92,000 views, sorted by views ↓)\n\n#1 | 1.4M views | 75.0×\nhttps://www.instagram.com/sample.studio/reel/DEMO0009/\n\n#2 | 214K views | 11.6×\nhttps://www.instagram.com/sample.studio/reel/DEMO0003/"
  );
});
