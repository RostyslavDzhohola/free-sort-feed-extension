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
    test(`@${entry.handle}: computed 5× set equals the extension's CSV export`, () => {
      const csvUrl = new URL(`${entry.handle}/extension-5x.csv`, dataDir);
      assert.ok(existsSync(csvUrl), `real profiles need src/data/demo/${entry.handle}/extension-5x.csv as ground truth`);
      const expected = parseCsv(readFileSync(csvUrl, "utf8"));
      const s = snapshotOf(entry.handle);
      const computed = core.findOutliers(s.reels, { mode: "ratio5x", followers: s.followers }).outliers;
      assert.deepEqual(computed.map((r) => r.url), expected.map((r) => r.url), "same Reels, same order");
      assert.deepEqual(computed.map((r) => r.views), expected.map((r) => Number(r.views)), "same views");
      assert.deepEqual(computed.map((r) => r.ratio.toFixed(4)), expected.map((r) => r.ratio), "same multiples (same follower count)");
      for (const row of expected) assert.equal(row.filter_mode, "ratio5x");
    });
  }
}
