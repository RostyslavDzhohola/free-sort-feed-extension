import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tempDir = new URL("./.tmp/", import.meta.url);
const outfile = new URL("./.tmp/empty-state-copy.mjs", import.meta.url);
const tempDirPath = fileURLToPath(tempDir);
const outfilePath = fileURLToPath(outfile);

async function loadHelper() {
  await mkdir(tempDir, { recursive: true });
  await build({
    entryPoints: ["src/shared/empty-state-copy.ts"],
    outfile: outfilePath,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    absWorkingDir: process.cwd(),
    logLevel: "silent",
  });
  return import(pathToFileURL(outfilePath).href + "?t=" + Date.now());
}

test("5× mode explains follower-based threshold and scan-limit next step", async () => {
  const { buildEmptyStateCopy } = await loadHelper();
  const copy = buildEmptyStateCopy({
    filterMode: "ratio5x",
    followers: 12_000,
    threshold: 60_000,
    minViews: null,
    scanLimit: 100,
  });

  assert.equal(copy.title, "No Reels hit the 5× filter.");
  assert.match(copy.detail, /12,000 followers/);
  assert.match(copy.detail, /60,000\+ views/);
  assert.match(copy.detail, /Switch to Min Views or raise the scan limit to see more/);
  assert.match(copy.detail, /Scanned: first 100 reels only/);
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
  assert.match(copy.detail, /Lower Min Views or raise the scan limit to see more/);
  assert.doesNotMatch(copy.detail, /Scanned: first .* reels only/);
  assert.equal(copy.status, "");
});

test.after(async () => {
  await rm(tempDirPath, { recursive: true, force: true });
});
