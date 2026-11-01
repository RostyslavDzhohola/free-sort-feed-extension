/**
 * Arrow keys on a non-linear slider move to the next *different* mapped value.
 *
 * The scan-limit and Min Views sliders have 1,000 positions with snap zones around their markers, so a
 * single native arrow step usually maps to the same value. (The v1.0.7 extension also re-snaps the thumb
 * on every input, which traps keyboard users at a marker.)
 */

/** Order of slider values: numbers ascending, with null ("All") above every number. */
function rank(value: number | null): number {
  return value === null ? Number.POSITIVE_INFINITY : value;
}

/**
 * First position from `position` in direction `dir` whose value lies beyond `current` in that direction,
 * or null at the end of the track. Pass the value the control shows: after a re-snap the thumb can sit in
 * a neighbouring marker's snap zone (475 reels lives inside 500's), so the thumb's own position isn't
 * always the value, and the nearest different value can even lie the "wrong" way.
 */
export function nextValuePosition(
  position: number,
  dir: 1 | -1,
  toValue: (position: number) => number | null,
  min: number,
  max: number,
  current: number | null = toValue(position)
): number | null {
  for (let p = position + dir; p >= min && p <= max; p += dir) {
    if ((rank(toValue(p)) - rank(current)) * dir > 0) return p;
  }
  return null;
}

/** Wire arrow keys to nextValuePosition, then fire the input's own `input` and `change` events. */
export function stepByValue(input: HTMLInputElement, toValue: (position: number) => number | null, currentValue?: () => number | null): void {
  input.addEventListener("keydown", (event) => {
    const dir = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (dir === 0 || input.disabled) return;
    event.preventDefault();
    const position = Number(input.value);
    const current = currentValue ? currentValue() : toValue(position);
    const next = nextValuePosition(position, dir, toValue, Number(input.min || 0), Number(input.max || 100), current);
    if (next === null) return;
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
