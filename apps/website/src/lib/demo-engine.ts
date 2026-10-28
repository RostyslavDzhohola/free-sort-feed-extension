// Scan replay state machine for the home page demo (DESIGN-SPEC §6.4). Pure: no DOM, no timers.
//
// It mirrors how the v1.0.7 side panel behaves (the scan is unchanged in v1.0.8):
// - idle → Run → scanning → (Stop | limit reached | grid exhausted) → done → Reset → idle
// - the extension collects whole batches of visible tiles before it checks the scan limit,
//   so a very small limit can collect a few extra Reels (the FAQ says so);
// - settings changed after a scan don't touch its results: they apply on the next Run, after Reset.
import {
  DEFAULT_MIN_VIEWS,
  buildEmptyStateCopy,
  findOutliers,
  formatCount,
  thresholdFor,
  thresholdLabel,
  type EmptyStateCopy,
  type FilterMode,
  type FilterResult,
  type ReelLike,
} from "@outliers/core";

export type Phase = "idle" | "scanning" | "done";

export interface ScanSettings {
  mode: FilterMode;
  minViews: number;
  /** null = All */
  scanLimit: number | null;
}

export interface ScanState<T extends ReelLike> {
  phase: Phase;
  /** Settings the current or last scan used. */
  applied: ScanSettings;
  /** Settings the controls show. They become `applied` when the panel is idle. */
  pending: ScanSettings;
  /** Reels collected so far, in grid order. */
  collected: number;
  result: FilterResult<T> | null;
}

/** Tiles Instagram has on screen per load. One batch is collected before the limit is checked. */
export const BATCH_SIZE = 12;

export const DEFAULT_SETTINGS: ScanSettings = { mode: "ratio5x", minViews: DEFAULT_MIN_VIEWS, scanLimit: 100 };

export function initialState<T extends ReelLike>(settings: ScanSettings = DEFAULT_SETTINGS): ScanState<T> {
  return { phase: "idle", applied: settings, pending: settings, collected: 0, result: null };
}

function analyze<T extends ReelLike>(reels: readonly T[], followers: number, settings: ScanSettings, collected: number) {
  return findOutliers(reels.slice(0, collected), { mode: settings.mode, followers, minViews: settings.minViews });
}

export function startScan<T extends ReelLike>(state: ScanState<T>, reels: readonly T[], followers: number): ScanState<T> {
  if (state.phase !== "idle") return state;
  return { ...state, phase: "scanning", applied: state.pending, collected: 0, result: analyze(reels, followers, state.pending, 0) };
}

/** A replay can't scan past its snapshot: All, or any limit above the Reels captured, becomes that count. */
export function capScanLimit(limit: number | null, captured: number): number {
  return limit === null || limit > captured ? captured : limit;
}

export function isComplete(collected: number, settings: ScanSettings, total: number): boolean {
  return collected >= total || (settings.scanLimit != null && collected >= settings.scanLimit);
}

/** Collect the next batch of tiles and re-rank everything collected so far. */
export function collectBatch<T extends ReelLike>(state: ScanState<T>, reels: readonly T[], followers: number): ScanState<T> {
  if (state.phase !== "scanning") return state;
  const collected = Math.min(reels.length, state.collected + BATCH_SIZE);
  const result = analyze(reels, followers, state.applied, collected);
  const phase = isComplete(collected, state.applied, reels.length) ? "done" : "scanning";
  return { ...state, phase, collected, result };
}

/** Run every remaining batch at once (reduced motion, or a finished replay). */
export function finishScan<T extends ReelLike>(state: ScanState<T>, reels: readonly T[], followers: number): ScanState<T> {
  let next = state;
  while (next.phase === "scanning") next = collectBatch(next, reels, followers);
  return next;
}

/** Stop finalizes immediately from what's been collected, like the extension's Stop button. */
export function stopScan<T extends ReelLike>(state: ScanState<T>): ScanState<T> {
  if (state.phase !== "scanning") return state;
  return { ...state, phase: "done" };
}

export function resetScan<T extends ReelLike>(state: ScanState<T>): ScanState<T> {
  return { ...state, phase: "idle", applied: state.pending, collected: 0, result: null };
}

/** Controls are locked while scanning. When idle, new settings take effect immediately. */
export function updateSettings<T extends ReelLike>(state: ScanState<T>, patch: Partial<ScanSettings>): ScanState<T> {
  if (state.phase === "scanning") return state;
  const pending = { ...state.pending, ...patch };
  return state.phase === "idle" ? { ...state, pending, applied: pending } : { ...state, pending };
}

export function hasPendingChanges<T extends ReelLike>(state: ScanState<T>): boolean {
  const { applied, pending } = state;
  return (
    state.phase === "done" &&
    (applied.mode !== pending.mode || applied.scanLimit !== pending.scanLimit || (pending.mode === "minViews" && applied.minViews !== pending.minViews))
  );
}

/** "Active threshold" as the panel shows it: the bar of the current or last scan. */
export function activeThreshold<T extends ReelLike>(state: ScanState<T>, followers: number): { value: number; label: string } {
  const value = thresholdFor(state.applied.mode, followers, state.applied.minViews);
  return { value, label: thresholdLabel(value) };
}

/** The panel's progress line, worded exactly like the extension's. */
export function progressText(collected: number, scanLimit: number | null): string {
  return scanLimit != null && scanLimit > 0
    ? "Scanning… " + collected + " / " + scanLimit + " reels"
    : "Scanning… " + collected + " reels found";
}

/** "— 6 of 36 reels" */
export function resultsMeta(outliers: number, collected: number): string {
  return "— " + outliers + " of " + collected + " reels";
}

/**
 * The extension's empty-state copy. Its scan-limit hint names the limit even when a batch overshot it,
 * so the replay passes the number of Reels actually collected instead.
 */
export function emptyState<T extends ReelLike>(state: ScanState<T>, followers: number): EmptyStateCopy {
  const threshold = activeThreshold(state, followers).value;
  const limited = state.applied.scanLimit != null && state.collected >= state.applied.scanLimit;
  return buildEmptyStateCopy({
    filterMode: state.applied.mode,
    followers,
    threshold,
    minViews: state.applied.mode === "minViews" ? state.applied.minViews : null,
    scanLimit: limited ? state.collected : null,
  });
}

/** The extension's "Copy" report: header, then "#1 | 1.4M views | 75.0x" and the URL per Reel. */
export function plainTextReport(handle: string, label: string, outliers: ReadonlyArray<{ url: string; views: number; ratio: number }>): string {
  const lines = ["Outliers report for @" + handle + " (" + label + ")", ""];
  outliers.forEach((reel, i) => {
    lines.push("#" + (i + 1) + " | " + formatCount(reel.views) + " views | " + reel.ratio.toFixed(1) + "x");
    lines.push(reel.url);
    lines.push("");
  });
  return lines.join("\n").trim();
}
