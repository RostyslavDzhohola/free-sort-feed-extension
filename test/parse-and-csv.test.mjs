import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { loadModule, tempDirPath } from "./load-module.mjs";

test("parses English and comma-decimal counts", async () => {
  const { parseCount } = await loadModule("src/shared/parse-count.ts");
  assert.equal(parseCount("2,345"), 2345);
  assert.equal(parseCount("12.3K"), 12_300);
  assert.equal(parseCount("1,2M"), 1_200_000);
  assert.equal(parseCount("1.234.567"), 1_234_567);
  assert.equal(parseCount("0.9B"), 900_000_000);
  assert.equal(parseCount("1 234"), 1234);
  assert.equal(parseCount("1,234.5K"), 1_234_500);
  assert.equal(parseCount("1.234,5K"), 1_234_500);
  assert.equal(parseCount("1.234.567K"), 1_234_567_000);
  assert.ok(Number.isNaN(parseCount("12..3K")));
  assert.ok(Number.isNaN(parseCount("Followed by")));
});

test("CSV keeps the 1.0.x columns first and appends every metric", async () => {
  const { buildOutliersCsv, buildSavedCsv } = await loadModule("src/shared/export-csv.ts");
  const csv = buildOutliersCsv(
    [{ url: "https://www.tiktok.com/@a/video/1", href: "/@a/video/1", views: 50_000, ratio: 25, platform: "tiktok", likes: 300, comments: 80, shares: 40, saves: 9, postedAt: 1_710_000_000, durationSec: 12 }],
    { profilePath: "https://www.tiktok.com/@a", filterMode: "all", thresholdLabel: "All videos", exportedAt: "2026-10-27T00:00:00.000Z", followers: 2_000, sortKey: "comments", sortDir: "desc" }
  );
  const [header, row] = csv.replace(/^﻿/, "").split("\n");
  assert.ok(header.startsWith("rank,url,views,ratio,profile,filter_mode,threshold_label,exported_at,"));
  assert.match(header, /platform,likes,comments,shares,saves,engagement_rate,posted_at,duration_sec,likes_hidden,followers,sort_by,sort_dir$/);
  const cells = row.split(",");
  assert.equal(cells[2], "50000");
  assert.equal(cells[3], "25.0000");
  assert.equal(cells[8], "tiktok");
  assert.equal(cells[13], ((300 + 80 + 40 + 9) / 50_000).toFixed(4));
  assert.equal(cells[14], "2024-03-09T16:00:00.000Z");
  assert.equal(cells.at(-2), "comments");

  // A Library entry saved by 1.0.x has only views and ratio.
  const saved = buildSavedCsv(
    [{ url: "https://www.instagram.com/heyrostyslav/reel/DaR-JSwNnKP/", href: "/heyrostyslav/reel/DaR-JSwNnKP/", views: 11_100, ratio: 17.1296, savedAt: "2026-10-05T01:26:12.395Z", profilePath: "https://www.instagram.com/heyrostyslav/" }],
    { exportedAt: "2026-10-27T00:00:00.000Z" }
  );
  const savedRow = saved.split("\n")[1].split(",");
  assert.deepEqual(savedRow.slice(0, 4), ["1", "https://www.instagram.com/heyrostyslav/reel/DaR-JSwNnKP/", "11100", "17.1296"]);
  assert.equal(savedRow[7], "instagram");
  assert.equal(savedRow[8], "");
});

test.after(async () => {
  await rm(tempDirPath, { recursive: true, force: true });
});

test("CSV writes a known zero ratio and skips dates it can't represent", async () => {
  const { buildOutliersCsv } = await loadModule("src/shared/export-csv.ts");
  const csv = buildOutliersCsv(
    [{ href: "/@a/video/1", url: "https://www.tiktok.com/@a/video/1", views: 0, ratio: 0, postedAt: 1e13 }],
    { profilePath: "https://www.tiktok.com/@a", filterMode: "all", thresholdLabel: "All", exportedAt: "2026-10-29T00:00:00.000Z", followers: 500 }
  );
  const row = csv.split("\n")[1].split(",");
  assert.equal(row[3], "0.0000");
  assert.equal(row[14], "");
});
