import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { loadModule, tempDirPath } from "./load-module.mjs";

const loadHelper = () => loadModule("src/shared/empty-state-copy.ts");

test("5× mode explains follower-based threshold and scan-limit next step", async () => {
  const { buildEmptyStateCopy } = await loadHelper();
  const copy = buildEmptyStateCopy({
    filterMode: "ratio5x",
    followers: 12_000,
    threshold: 60_000,
    minViews: null,
    scanLimit: 100,
    scannedCount: 100,
  });

  assert.equal(copy.title, "No Reels hit the 5× filter.");
  assert.match(copy.detail, /12,000 followers/);
  assert.match(copy.detail, /60,000\+ views/);
  assert.match(copy.detail, /Switch to Min Views or All to see more/);
  assert.match(copy.detail, /Scanned the first 100 Reels only/);
  assert.equal(copy.status, "");
});

test("min-views mode tells the user to lower the threshold", async () => {
  const { buildEmptyStateCopy } = await loadHelper();
  const copy = buildEmptyStateCopy({
    filterMode: "minViews",
    followers: 12_000,
    threshold: 25_000,
    minViews: 25_000,
    scanLimit: null,
  });

  assert.equal(copy.title, "No Reels hit your minimum views filter.");
  assert.match(copy.detail, /25,000 views/);
  assert.match(copy.detail, /Lower Min Views, or pick All/);
  assert.doesNotMatch(copy.detail, /Scanned the first/);
  assert.equal(copy.status, "");
});

test("scan-limit hint is dropped when the profile had fewer videos than the limit", async () => {
  const { buildEmptyStateCopy } = await loadHelper();
  const copy = buildEmptyStateCopy({
    filterMode: "ratio5x",
    followers: 500,
    threshold: 2_500,
    minViews: null,
    scanLimit: 100,
    scannedCount: 12,
  });
  assert.doesNotMatch(copy.detail, /Scanned the first/);
});

test("TikTok copy says videos, and 5× without followers points to the other modes", async () => {
  const { buildEmptyStateCopy } = await loadHelper();
  const copy = buildEmptyStateCopy({
    platform: "tiktok",
    filterMode: "ratio5x",
    followers: null,
    threshold: null,
    minViews: null,
    scanLimit: null,
  });
  assert.equal(copy.title, "The 5× filter needs a follower count.");
  assert.match(copy.detail, /Min Views or All to see its videos/);
});

test.after(async () => {
  await rm(tempDirPath, { recursive: true, force: true });
});
