import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const { caseView, formatTimes, barWidth } = await loadTs("../src/lib/compare.ts");

test("verdicts at the default 100,000-view bar match the prototype", () => {
  assert.equal(caseView(2_400, 100_000).verdict, "Min Views is the stricter bar here, 8.3× higher. 5× lets more Reels through.");
  assert.equal(caseView(18_400, 100_000).verdict, "Min Views is the stricter bar here, 1.1× higher. 5× lets more Reels through.");
  assert.equal(caseView(1_200_000, 100_000).verdict, "5× is the stricter bar here, 60× higher. Min Views lets more Reels through.");
  assert.equal(caseView(20_000, 100_000).verdict, "Both modes land on the same bar for this account.");
});

test("bar labels use formatCount", () => {
  const view = caseView(18_400, 100_000);
  assert.equal(view.bar5Label, "92K");
  assert.equal(view.minLabel, "100K");
  assert.equal(caseView(1_200_000, 1_000).bar5Label, "6M");
});

test("multiples round at 10× and drop a trailing .0", () => {
  assert.equal(formatTimes(8.333), "8.3×");
  assert.equal(formatTimes(2), "2×");
  assert.equal(formatTimes(9.96), "10×");
  assert.equal(formatTimes(60.2), "60×");
});

test("bars sit on a 1K–10M log track", () => {
  assert.equal(barWidth(1_000), "0.0%");
  assert.equal(barWidth(500), "0.0%");
  assert.equal(barWidth(100_000), "50.0%");
  assert.equal(barWidth(10_000_000), "100.0%");
  assert.equal(barWidth(50_000_000), "100.0%");
});
