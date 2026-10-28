// Demo labels shared by the server render and the island: the honesty line and the creator credit.
import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const { honestyLabel, creditFor } = await loadTs("../src/lib/demo-copy.ts");

const base = { capturedLabel: "Oct 4, 2026", owner: false };
const sample = { ...base, handle: "sample.studio", kind: "sample", permission: "granted" };
const creatorPending = { ...base, handle: "benaratame", kind: "real", permission: "pending" };
const creatorGranted = { ...creatorPending, permission: "granted" };
const owner = { ...base, handle: "heyrostyslav", kind: "real", permission: "granted", owner: true };

test("honesty label names the data source", () => {
  assert.equal(honestyLabel(sample), "Sample data from a fictional profile, @sample.studio.");
  // "Snapshot", not "scan": a snapshot isn't always captured in the same session as its verifying export.
  for (const p of [creatorPending, creatorGranted, owner]) {
    assert.equal(
      honestyLabel(p),
      "Replay of a real snapshot captured Oct 4, 2026, checked against the extension's own export. Live numbers on Instagram will differ.",
    );
  }
});

test("third-party creators get a credit with their Instagram link and a disclosure", () => {
  const credit = creditFor(creatorGranted);
  assert.equal(credit.handle, "benaratame");
  assert.equal(credit.href, "https://www.instagram.com/benaratame/");
  assert.equal(credit.lead, "Featured creator:");
  assert.equal(credit.detail, "Reels, numbers and thumbnails belong to @benaratame, shown with permission. Not affiliated with Outliers.");
});

test("a pending creator's credit says permission is pending, never 'with permission'", () => {
  const credit = creditFor(creatorPending);
  assert.equal(credit.href, "https://www.instagram.com/benaratame/");
  assert.match(credit.detail, /^Reels, numbers and thumbnails belong to @benaratame\./);
  assert.match(credit.detail, /Permission pending: dev preview only\./);
  assert.doesNotMatch(credit.detail, /with permission/);
});

test("the owner's own profile and the fictional sample need no credit", () => {
  assert.equal(creditFor(owner), null);
  assert.equal(creditFor(sample), null);
});
