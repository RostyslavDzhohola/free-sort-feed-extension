import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const { nextValuePosition } = await loadTs("../src/lib/range-keys.ts");
const core = await loadTs("../../../packages/core/src/index.ts");

// Press an arrow key until the end, re-snapping the thumb to the value's own position after every step
// (what the demo does on `change`). Values must change monotonically and the walk must reach the end.
function walk(start, dir, toValue, toPosition, order) {
  const values = [toValue(start)];
  let position = start;
  for (let presses = 0; presses < 2000; presses++) {
    const next = nextValuePosition(position, dir, toValue, 0, 1000, values.at(-1));
    if (next === null) return values;
    const value = toValue(next);
    assert.ok(order(values.at(-1), value), `value went ${values.at(-1)} → ${value}`);
    values.push(value);
    position = toPosition(value);
  }
  throw new Error("arrow keys never reached the end of the track");
}

const limitOrder = (a, b) => (a === null ? false : b === null ? true : b > a);
const limitOrderDown = (a, b) => (a === null ? b !== null : b !== null && b < a);

test("scan-limit arrows step through every value from 1 to All and back", () => {
  const up = walk(core.scanLimitToSliderPosition(1), 1, core.sliderPositionToScanLimit, core.scanLimitToSliderPosition, limitOrder);
  assert.equal(up[0], 1);
  assert.equal(up.at(-1), null, "reaches All");
  for (const marker of [100, 150, 200, 500]) assert.ok(up.includes(marker), `passes ${marker}`);
  const down = walk(core.scanLimitToSliderPosition(null), -1, core.sliderPositionToScanLimit, core.scanLimitToSliderPosition, limitOrderDown);
  assert.equal(down.at(-1), 1);
});

test("Min Views arrows step through every value from 1K to 1M and back", () => {
  const up = walk(core.minViewsToSliderPosition(1000), 1, core.sliderPositionToMinViews, core.minViewsToSliderPosition, (a, b) => b > a);
  assert.equal(up.at(-1), 1_000_000);
  for (const marker of [10_000, 100_000]) assert.ok(up.includes(marker), `passes ${marker}`);
  const down = walk(core.minViewsToSliderPosition(1_000_000), -1, core.sliderPositionToMinViews, core.minViewsToSliderPosition, (a, b) => b < a);
  assert.equal(down.at(-1), 1000);
});
