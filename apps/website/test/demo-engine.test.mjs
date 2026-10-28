import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./load-ts.mjs";

const engine = await loadTs("../src/lib/demo-engine.ts");
const sample = JSON.parse(readFileSync(new URL("../src/data/demo/sample.studio/snapshot.json", import.meta.url), "utf8"));
const { reels, followers } = sample;

const scan = (settings) => engine.finishScan(engine.startScan(engine.initialState(settings), reels, followers), reels, followers);

test("a full 5× scan of the sample ranks 6 of 36 Reels by views", () => {
  const done = scan(engine.DEFAULT_SETTINGS);
  assert.equal(done.phase, "done");
  assert.equal(done.collected, 36);
  assert.deepEqual(done.result.outliers.map((r) => r.views), [1_380_000, 520_000, 312_000, 214_000, 141_000, 96_300]);
  assert.equal(engine.activeThreshold(done, followers).label, "92,000 views");
  assert.equal(engine.resultsMeta(done.result.outliers.length, done.collected), "— 6 of 36 reels");
});

test("Reels are collected in batches, so a tiny limit collects a whole batch", () => {
  const one = scan({ ...engine.DEFAULT_SETTINGS, scanLimit: 1 });
  assert.equal(one.collected, engine.BATCH_SIZE);
  const thirteen = scan({ ...engine.DEFAULT_SETTINGS, scanLimit: 13 });
  assert.equal(thirteen.collected, 24);
  const all = scan({ ...engine.DEFAULT_SETTINGS, scanLimit: null });
  assert.equal(all.collected, 36);
});

test("results fill in live while scanning, and Stop finalizes what's collected", () => {
  let state = engine.startScan(engine.initialState(), reels, followers);
  assert.equal(state.phase, "scanning");
  assert.equal(state.result.outliers.length, 0);
  state = engine.collectBatch(state, reels, followers);
  assert.equal(state.collected, 12);
  assert.equal(state.phase, "scanning");
  assert.deepEqual(state.result.outliers.map((r) => r.views), [1_380_000, 214_000]);
  state = engine.stopScan(state);
  assert.equal(state.phase, "done");
  assert.equal(state.collected, 12);
});

test("settings changed after a scan apply only after Reset → Run", () => {
  let state = scan(engine.DEFAULT_SETTINGS);
  state = engine.updateSettings(state, { mode: "minViews", minViews: 300_000 });
  assert.equal(state.applied.mode, "ratio5x", "results keep the bar they were made with");
  assert.equal(state.result.outliers.length, 6);
  assert.equal(engine.hasPendingChanges(state), true);
  state = engine.resetScan(state);
  assert.equal(state.phase, "idle");
  assert.equal(state.result, null);
  assert.equal(state.applied.mode, "minViews");
  state = engine.finishScan(engine.startScan(state, reels, followers), reels, followers);
  assert.deepEqual(state.result.outliers.map((r) => r.views), [1_380_000, 520_000, 312_000]);
  assert.equal(engine.hasPendingChanges(state), false);
});

test("controls are locked while scanning; idle changes apply at once", () => {
  const scanning = engine.startScan(engine.initialState(), reels, followers);
  assert.equal(engine.updateSettings(scanning, { mode: "minViews" }), scanning);
  const idle = engine.updateSettings(engine.initialState(), { scanLimit: 200 });
  assert.equal(idle.applied.scanLimit, 200);
});

test("progress text matches the extension's wording", () => {
  assert.equal(engine.progressText(24, 100), "Scanning… 24 / 100 reels");
  assert.equal(engine.progressText(24, null), "Scanning… 24 reels found");
});

test("empty results use the extension's copy, naming the Reels actually collected", () => {
  const none = scan({ mode: "minViews", minViews: 1_000_000, scanLimit: 1 });
  assert.equal(none.result.outliers.length, 1, "1.38M clears 1M");
  const empty = scan({ mode: "minViews", minViews: 2_000_000, scanLimit: 1 });
  const copy = engine.emptyState(empty, followers);
  assert.equal(copy.title, "No Reels hit your minimum views filter.");
  assert.equal(copy.detail, "Current minimum: 2,000,000 views. Lower Min Views or raise the scan limit to see more. Scanned: first 12 reels only.");
  const fullEmpty = scan({ mode: "minViews", minViews: 2_000_000, scanLimit: null });
  assert.ok(!engine.emptyState(fullEmpty, followers).detail.includes("Scanned:"), "no limit hint when the whole grid was read");
});

test("the plain-text report matches the extension's Copy format", () => {
  const done = scan(engine.DEFAULT_SETTINGS);
  const text = engine.plainTextReport("sample.studio", "92,000 views", done.result.outliers.slice(0, 2));
  assert.equal(
    text,
    "Outliers report for @sample.studio (92,000 views)\n\n#1 | 1.4M views | 75.0x\nhttps://www.instagram.com/sample.studio/reel/DEMO0009/\n\n#2 | 520K views | 28.3x\nhttps://www.instagram.com/sample.studio/reel/DEMO0035/"
  );
});
