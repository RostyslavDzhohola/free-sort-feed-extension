// Slider curves, ported from apps/extension/src/sidepanel.ts (v1.0.7).
// test/sliders.test.mjs checks every slider position against a fixture extracted from that file.

import { formatExact } from "./count";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Scan limit: 1 → 100 → 150 → 200 → 500 → (25-step) 975 → All ──────────

export const SCAN_SLIDER_MAX = 1000;
const SCAN_LIMIT_MIN = 1;
const SCAN_LIMIT_MAX = 975;
const SCAN_LIMIT_ANCHORS = [1, 100, 150, 200, 500] as const;
const SCAN_LIMIT_SNAP_VALUES = [
  1, 100, 150, 200,
  500, 525, 550, 575, 600, 625, 650, 675, 700, 725, 750, 775, 800, 825, 850, 875, 900, 925, 950, 975,
] as const;
const SCAN_LIMIT_SNAP_DISTANCE = 16;
const SCAN_SEGMENT_WIDTH = SCAN_SLIDER_MAX / SCAN_LIMIT_ANCHORS.length;
const SCAN_PRE_ALL_START_POSITION = SCAN_SEGMENT_WIDTH * (SCAN_LIMIT_ANCHORS.length - 1);
const SCAN_PRE_ALL_END_POSITION = SCAN_SLIDER_MAX - 1;
const SCAN_PRE_ALL_MIN = 500;
const SCAN_PRE_ALL_MAX = 975;

function normalizeScanLimit(limit: number | null): number | null {
  if (limit == null) return null;
  return clamp(Math.round(limit), SCAN_LIMIT_MIN, SCAN_LIMIT_MAX);
}

function roundScanLimitValue(raw: number): number {
  const value = clamp(raw, SCAN_LIMIT_MIN, SCAN_LIMIT_MAX);
  if (value <= 20) return Math.round(value);
  if (value <= 200) return Math.round(value / 5) * 5;
  return Math.round(value / 25) * 25;
}

function interpolateGeometric(start: number, end: number, t: number): number {
  if (start <= 0 || end <= 0 || start === end) return start;
  return start * Math.pow(end / start, clamp(t, 0, 1));
}

function inverseGeometric(value: number, start: number, end: number): number {
  if (start <= 0 || end <= 0 || start === end) return 0;
  const safe = clamp(value, Math.min(start, end), Math.max(start, end));
  return Math.log(safe / start) / Math.log(end / start);
}

/** Scan limit (null = All) → slider position 0–1000. */
export function scanLimitToSliderPosition(limit: number | null): number {
  if (limit == null) return SCAN_SLIDER_MAX;
  const safe = normalizeScanLimit(limit) ?? SCAN_LIMIT_MIN;

  if (safe > SCAN_PRE_ALL_MIN) {
    const t = (safe - SCAN_PRE_ALL_MIN) / (SCAN_PRE_ALL_MAX - SCAN_PRE_ALL_MIN);
    return Math.round(
      SCAN_PRE_ALL_START_POSITION + (t * (SCAN_PRE_ALL_END_POSITION - SCAN_PRE_ALL_START_POSITION))
    );
  }

  for (let i = 0; i < SCAN_LIMIT_ANCHORS.length - 1; i++) {
    const start = SCAN_LIMIT_ANCHORS[i]!;
    const end = SCAN_LIMIT_ANCHORS[i + 1]!;
    if (safe >= start && safe <= end) {
      const t = inverseGeometric(safe, start, end);
      return Math.round((i * SCAN_SEGMENT_WIDTH) + (t * SCAN_SEGMENT_WIDTH));
    }
  }

  return SCAN_PRE_ALL_START_POSITION;
}

/** Slider position 0–1000 → scan limit (null = All), with the extension's snapping. */
export function sliderPositionToScanLimit(position: number): number | null {
  const safePosition = Math.round(clamp(position, 0, SCAN_SLIDER_MAX));
  if (safePosition >= SCAN_SLIDER_MAX) return null;

  let rawLimit: number;
  if (safePosition >= SCAN_PRE_ALL_START_POSITION) {
    const localT =
      (safePosition - SCAN_PRE_ALL_START_POSITION) /
      (SCAN_PRE_ALL_END_POSITION - SCAN_PRE_ALL_START_POSITION);
    rawLimit = SCAN_PRE_ALL_MIN + (localT * (SCAN_PRE_ALL_MAX - SCAN_PRE_ALL_MIN));
  } else {
    const segmentIndex = Math.min(
      SCAN_LIMIT_ANCHORS.length - 2,
      Math.floor(safePosition / SCAN_SEGMENT_WIDTH)
    );
    const segmentStartPosition = segmentIndex * SCAN_SEGMENT_WIDTH;
    const localT = (safePosition - segmentStartPosition) / SCAN_SEGMENT_WIDTH;
    const segmentStartValue = SCAN_LIMIT_ANCHORS[segmentIndex]!;
    const segmentEndValue = SCAN_LIMIT_ANCHORS[segmentIndex + 1]!;
    rawLimit = interpolateGeometric(segmentStartValue, segmentEndValue, localT);
  }

  let closestAnchor = roundScanLimitValue(rawLimit);
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SCAN_LIMIT_SNAP_VALUES.length; i++) {
    const anchor = SCAN_LIMIT_SNAP_VALUES[i]!;
    const anchorPosition = scanLimitToSliderPosition(anchor);
    const distance = Math.abs(safePosition - anchorPosition);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestAnchor = anchor;
    }
  }
  if (closestDistance <= SCAN_LIMIT_SNAP_DISTANCE) {
    return closestAnchor;
  }

  return roundScanLimitValue(rawLimit);
}

/** "100 reels" / "All reels", as the side panel labels the scan limit. */
export function formatScanLimit(limit: number | null): string {
  return limit === null ? "All reels" : formatExact(limit) + " reels";
}

// ── Min Views: log scale 1K–1M, snapping near 1K / 10K / 100K / 1M ────────

export const MIN_VIEWS_SLIDER_MAX = 1000;
const MIN_VIEWS_MIN = 1_000;
const MIN_VIEWS_MAX = 1_000_000;
const MIN_VIEWS_MARKERS = [1_000, 10_000, 100_000, 1_000_000] as const;
const MIN_VIEWS_SNAP_DISTANCE = 24;

function ratioToLogValue(ratio: number, min: number, max: number): number {
  if (min <= 0 || max <= 0) return min;
  const safeRatio = clamp(ratio, 0, 1);
  const minLog = Math.log(min);
  const maxLog = Math.log(max);
  return Math.exp(minLog + (maxLog - minLog) * safeRatio);
}

function logValueToRatio(value: number, min: number, max: number): number {
  if (min <= 0 || max <= 0 || min === max) return 0;
  const safeValue = clamp(value, min, max);
  const minLog = Math.log(min);
  const maxLog = Math.log(max);
  return (Math.log(safeValue) - minLog) / (maxLog - minLog);
}

function roundMinViewsValue(raw: number): number {
  const safe = clamp(raw, MIN_VIEWS_MIN, MIN_VIEWS_MAX);
  if (safe < 10_000) return Math.round(safe / 100) * 100;
  if (safe < 100_000) return Math.round(safe / 1_000) * 1_000;
  return Math.round(safe / 10_000) * 10_000;
}

/** Min Views → slider position 0–1000. */
export function minViewsToSliderPosition(value: number): number {
  const safe = clamp(Math.round(value), MIN_VIEWS_MIN, MIN_VIEWS_MAX);
  const ratio = logValueToRatio(safe, MIN_VIEWS_MIN, MIN_VIEWS_MAX);
  return Math.round(ratio * MIN_VIEWS_SLIDER_MAX);
}

/** Slider position 0–1000 → Min Views, with the extension's snapping. */
export function sliderPositionToMinViews(position: number): number {
  const safePosition = Math.round(clamp(position, 0, MIN_VIEWS_SLIDER_MAX));
  let closestMarker: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < MIN_VIEWS_MARKERS.length; i++) {
    const marker = MIN_VIEWS_MARKERS[i]!;
    const markerPosition = minViewsToSliderPosition(marker);
    const distance = Math.abs(safePosition - markerPosition);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestMarker = marker;
    }
  }

  if (closestMarker != null && closestDistance <= MIN_VIEWS_SNAP_DISTANCE) {
    return closestMarker;
  }

  const ratio = safePosition / MIN_VIEWS_SLIDER_MAX;
  const raw = ratioToLogValue(ratio, MIN_VIEWS_MIN, MIN_VIEWS_MAX);
  return roundMinViewsValue(raw);
}
