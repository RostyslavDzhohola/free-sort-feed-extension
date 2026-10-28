// Validates every demo snapshot, and checks each real one against the extension's own CSV export:
// the 5× set computed by @outliers/core must equal extension-5x.csv (DESIGN-SPEC §6.4).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loadTs } from "./load-ts.mjs";

const core = await loadTs("../../../packages/core/src/index.ts");
const dataDir = new URL("../src/data/demo/", import.meta.url);
const publicDir = new URL("../public/demo/", import.meta.url);
const entries = JSON.parse(readFileSync(new URL("profiles.json", dataDir), "utf8"));
const snapshotOf = (handle) => JSON.parse(readFileSync(new URL(`${handle}/snapshot.json`, dataDir), "utf8"));

/** Minimal CSV parser for the extension's export (BOM, quoted fields). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((f) => f !== ""));
  header[0] = header[0].replace(/^﻿/, "");
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

test("profiles.json entries are well-formed and unique", () => {
  const handles = entries.map((e) => e.handle);
  assert.equal(new Set(handles).size, handles.length);
  for (const e of entries) {
    assert.match(e.handle, /^[a-z0-9._]+$/i);
    assert.ok(["real", "sample"].includes(e.kind), e.handle);
    assert.ok(["pending", "granted"].includes(e.permission), e.handle);
  }
  assert.ok(entries.some((e) => e.kind === "sample"), "keep @sample.studio as the fallback dataset");
});

for (const entry of entries) {
  test(`@${entry.handle}: snapshot shape`, () => {
    const s = snapshotOf(entry.handle);
    assert.equal(s.handle, entry.handle);
    assert.ok(Number.isInteger(s.followers) && s.followers > 0);
    assert.match(s.capturedAt, /^\d{4}-\d{2}-\d{2}/);
    assert.equal(s.reelCount, s.reels.length);
    const shortcodes = new Set();
    for (const r of s.reels) {
      assert.ok(Number.isFinite(r.views) && r.views >= 0, r.shortcode);
      assert.equal(r.url, `https://www.instagram.com/${entry.handle}/reel/${r.shortcode}/`);
      assert.ok(!shortcodes.has(r.shortcode), `duplicate ${r.shortcode}`);
      shortcodes.add(r.shortcode);
      if (entry.kind === "real") {
        assert.equal(typeof r.thumb, "string", `${r.shortcode} needs a thumbnail`);
        assert.ok(existsSync(new URL(`${entry.handle}/${r.thumb}`, publicDir)), `missing public/demo/${entry.handle}/${r.thumb}`);
      }
    }
  });

  if (entry.kind === "real") {
    // The extension's export covers its own scan (e.g. 102 Reels at a 100 limit); the snapshot holds the
    // first N Reels of the grid. So compare within the snapshot, and account for the rows beyond it.
    test(`@${entry.handle}: computed 5× set matches the extension's CSV export`, () => {
      const csvUrl = new URL(`${entry.handle}/extension-5x.csv`, dataDir);
      assert.ok(existsSync(csvUrl), `real profiles need src/data/demo/${entry.handle}/extension-5x.csv as ground truth`);
      const csv = parseCsv(readFileSync(csvUrl, "utf8"));
      const s = snapshotOf(entry.handle);
      const inSnapshot = new Map(s.reels.map((r) => [r.url, r]));
      const computed = core.findOutliers(s.reels, { mode: "ratio5x", followers: s.followers }).outliers;
      const csvByUrl = new Map(csv.map((row) => [row.url, row]));
      for (const row of csv) assert.equal(row.filter_mode, "ratio5x");

      // Every computed outlier is in the export, with the same views.
      for (const reel of computed) {
        assert.ok(csvByUrl.has(reel.url), `${reel.url} is an outlier here but not in the extension's CSV`);
        assert.equal(Number(csvByUrl.get(reel.url).views), reel.views, reel.url);
      }
      // Every exported outlier that's in the snapshot is computed, in the same (views-descending) order.
      const csvWithin = csv.filter((row) => inSnapshot.has(row.url));
      assert.deepEqual(computed.map((r) => r.url), csvWithin.map((row) => row.url));

      // The rest of the export lies beyond the snapshot, as the capture's comparison.json records.
      const csvOnly = csv.filter((row) => !inSnapshot.has(row.url)).map((row) => row.url);
      const comparisonUrl = new URL(`${entry.handle}/comparison.json`, dataDir);
      if (existsSync(comparisonUrl)) {
        const comparison = JSON.parse(readFileSync(comparisonUrl, "utf8"));
        assert.deepEqual(csvOnly, (comparison.csvOnlyBeyondSnapshot ?? []).map((row) => row.url));
      }

      // The export's multiples imply the follower count the extension read. Same set under that bar too,
      // i.e. no Reel in the snapshot falls between the two bars.
      const implied = Math.round(Number(csv[0].views) / Number(csv[0].ratio));
      const underImplied = core.findOutliers(s.reels, { mode: "ratio5x", followers: implied }).outliers;
      assert.deepEqual(underImplied.map((r) => r.url), computed.map((r) => r.url), `bar ${implied * 5} vs ${s.followers * 5}`);
    });
  }
}
