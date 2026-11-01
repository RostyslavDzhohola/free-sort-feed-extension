import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { loadModule, tempDirPath } from "./load-module.mjs";

const load = () => loadModule("src/shared/videos.ts");

function video(id, fields) {
  return { url: "https://www.tiktok.com/@a/video/" + id, href: "/@a/video/" + id, ratio: 0, platform: "tiktok", ...fields };
}

const VIDEOS = [
  video(1, { views: 10_000, likes: 900, comments: 5, shares: 2, saves: 1, postedAt: 1_700_000_000, durationSec: 30 }),
  video(2, { views: 50_000, likes: 300, comments: 80, shares: 40, saves: 9, postedAt: 1_710_000_000, durationSec: 12 }),
  video(3, { views: 2_000, likes: null, comments: 200, shares: null, saves: null, postedAt: null, durationSec: 61, likesHidden: true }),
  video(4, { views: null, likes: 50, comments: 1, shares: 0, saves: 0, postedAt: 1_690_000_000, durationSec: null }),
];

const view = (over) => ({ filterMode: "all", minViews: 10_000, sortKey: "views", sortDir: "desc", ...over });
const ids = (list) => list.map((v) => Number(v.url.split("/").pop()));

test("All shows every video; unknown values sort last in both directions", async () => {
  const { selectVideos } = await load();
  assert.deepEqual(ids(selectVideos(VIDEOS, view({}), null)), [2, 1, 3, 4]);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortDir: "asc" }), null)), [3, 1, 2, 4]);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "likes" }), null)), [1, 2, 4, 3]);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "likes", sortDir: "asc" }), null)), [4, 2, 1, 3]);
});

test("sorts by comments, shares, saves, date and length", async () => {
  const { selectVideos } = await load();
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "comments" }), null)), [3, 2, 1, 4]);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "shares" }), null)), [2, 1, 4, 3]);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "saves" }), null)), [2, 1, 4, 3]);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "date" }), null)), [2, 1, 4, 3]);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "date", sortDir: "asc" }), null)), [4, 1, 2, 3]);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "duration" }), null)), [3, 1, 2, 4]);
});

test("engagement needs views, likes and comments; it counts shares and saves", async () => {
  const { engagementRate, selectVideos } = await load();
  assert.equal(engagementRate(VIDEOS[0]), (900 + 5 + 2 + 1) / 10_000);
  assert.equal(engagementRate(VIDEOS[2]), null);
  assert.equal(engagementRate(VIDEOS[3]), null);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "engagement" }), null)), [1, 2, 3, 4]);
});

test("5× needs followers and keeps views ≥ 5 × followers; Min Views needs none", async () => {
  const { selectVideos, getThreshold } = await load();
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ filterMode: "ratio5x" }), 2_000)), [2, 1]);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ filterMode: "ratio5x" }), null)), []);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ filterMode: "minViews", minViews: 10_000 }), null)), [2, 1]);
  assert.equal(getThreshold("ratio5x", 660, null), 3_300);
  assert.equal(getThreshold("minViews", null, null), 10_000);
  assert.equal(getThreshold("all", 660, 5_000), null);
});

test("views ÷ followers uses the live count, then the stored ratio of 1.0.x entries", async () => {
  const { viewsMultiple, selectVideos } = await load();
  assert.equal(viewsMultiple(VIDEOS[1], 1_000), 50);
  assert.equal(viewsMultiple({ url: "x", href: "x", views: 11_100, ratio: 17.1296 }, null), 17.1296);
  assert.equal(viewsMultiple({ url: "x", href: "x", views: 11_100, ratio: 0 }, null), null);
  assert.deepEqual(ids(selectVideos(VIDEOS, view({ sortKey: "multiple" }), 1_000)), [2, 1, 3, 4]);
});

test("TikTok-only sort keys fall back to views on Instagram", async () => {
  const { resolveSortKey, sortOptionsFor } = await load();
  assert.equal(resolveSortKey("shares", "instagram"), "views");
  assert.equal(resolveSortKey("date", "instagram"), "views");
  assert.equal(resolveSortKey("comments", "instagram"), "comments");
  assert.equal(resolveSortKey("shares", "tiktok"), "shares");
  assert.deepEqual(sortOptionsFor("instagram").map((o) => o.key), ["views", "likes", "comments", "engagement", "multiple"]);
  assert.equal(sortOptionsFor("tiktok").length, 9);
});

test("formats metric phrases", async () => {
  const { formatMetricPhrase, formatPercent, formatDuration } = await load();
  assert.equal(formatMetricPhrase("comments", 1_234), "1.2K comments");
  assert.equal(formatMetricPhrase("likes", null, true), "likes hidden");
  assert.equal(formatMetricPhrase("likes", null), "likes not shown");
  assert.equal(formatMetricPhrase("shares", 1), "1 share");
  assert.equal(formatMetricPhrase("views", 0), "0 views");
  assert.equal(formatMetricPhrase("multiple", 12.44), "12.4× followers");
  assert.equal(formatMetricPhrase("engagement", 0.0412), "4.1% engagement");
  assert.equal(formatPercent(0.0005), "0.05%");
  assert.equal(formatDuration(61), "1:01");
  const { formatMultiple } = await load();
  assert.equal(formatMultiple(17.13), "17.1×");
  assert.equal(formatMultiple(0.0131), "0.01×");
  assert.equal(formatMultiple(0.42), "0.42×");
  assert.equal(formatMultiple(0.004), "0.004×");
});

test.after(async () => {
  await rm(tempDirPath, { recursive: true, force: true });
});
