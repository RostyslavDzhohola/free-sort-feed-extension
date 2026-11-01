import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { loadModule, tempDirPath } from "./load-module.mjs";

const load = () => loadModule("src/shared/platform.ts");

test("reads Instagram and TikTok profiles from URLs", async () => {
  const { getProfileRef } = await load();
  assert.deepEqual(getProfileRef("https://www.instagram.com/NatGeo/reels/"), { platform: "instagram", handle: "natgeo" });
  assert.deepEqual(getProfileRef("https://www.instagram.com/heyrostyslav/"), { platform: "instagram", handle: "heyrostyslav" });
  assert.deepEqual(getProfileRef("https://www.tiktok.com/@Khaby.Lame?lang=en"), { platform: "tiktok", handle: "khaby.lame" });
  assert.equal(getProfileRef("https://www.instagram.com/explore/"), null);
  assert.equal(getProfileRef("https://www.instagram.com/reel/De5ZYSctAru/"), null);
  assert.equal(getProfileRef("https://www.instagram.com/natgeo/reel/De5ZYSctAru/"), null);
  assert.equal(getProfileRef("https://www.tiktok.com/@a/video/123"), null);
  assert.equal(getProfileRef("https://www.tiktok.com/foryou"), null);
  assert.equal(getProfileRef("https://example.com/@a"), null);
});

test("tells video permalinks from profile tabs", async () => {
  const { isContentPermalink, isScanPage } = await load();
  assert.equal(isContentPermalink("https://www.instagram.com/reel/De5ZYSctAru/"), true);
  assert.equal(isContentPermalink("https://www.instagram.com/natgeo/reel/De5ZYSctAru/"), true);
  assert.equal(isContentPermalink("https://www.instagram.com/p/abc/"), true);
  assert.equal(isContentPermalink("https://www.instagram.com/natgeo/reels/"), false);
  assert.equal(isContentPermalink("https://www.tiktok.com/@a/video/7700394277263658253"), true);
  assert.equal(isContentPermalink("https://www.tiktok.com/@a/photo/7700394277263658253"), true);
  assert.equal(isContentPermalink("https://www.tiktok.com/@a"), false);
  assert.equal(isScanPage("https://www.instagram.com/natgeo/reels/"), true);
  assert.equal(isScanPage("https://www.instagram.com/natgeo/"), false);
  assert.equal(isScanPage("https://www.tiktok.com/@a"), true);
});

test("finds the creator from a saved video URL", async () => {
  const { getProfileUrlFromVideoUrl } = await load();
  assert.equal(getProfileUrlFromVideoUrl("https://www.instagram.com/natgeo/reel/X/"), "https://www.instagram.com/natgeo/");
  assert.equal(getProfileUrlFromVideoUrl("https://www.instagram.com/reel/X/"), null);
  assert.equal(getProfileUrlFromVideoUrl("https://www.tiktok.com/@a.b/video/1"), "https://www.tiktok.com/@a.b");
});

test.after(async () => {
  await rm(tempDirPath, { recursive: true, force: true });
});
