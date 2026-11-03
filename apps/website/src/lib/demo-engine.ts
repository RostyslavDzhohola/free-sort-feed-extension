// Scan replay state machine for the home page demo (DESIGN-SPEC §6.4). Pure: no DOM, no timers.
//
// It mirrors how the 1.1 side panel behaves (v1.1.1, the store version):
// - idle → Run → scanning → (Stop | limit reached | grid exhausted) → done → Reset → idle
//   (a limit above the snapshot's Reels, or All, ends when the grid runs out, as on a profile's last Reel);
// - the scan stops at exactly the scan limit: "first 100" means the first 100 Reels in grid order;
// - Show (5× Outliers, Min Views, All) and Sort by reshape what was scanned, at once, during and after a scan;
// - the scan limit is locked while scanning, and a new one applies to the next scan, after Reset → Run.
import {
  DEFAULT_MIN_VIEWS,
  buildEmptyStateCopy,
  buildOutliersPlainText,
  findOutliers,
  pageGridMeta,
  thresholdLabel,
  videoNoun,
  type EmptyStateCopy,
  type FilterMode,
  type FilterResult,
  type ReelLike,
  type SortDir,
  type SortKey,
} from "@outliers/core";

export type Phase = "idle" | "scanning" | "done";

/** What the panel's controls show. Show and Sort by always apply at once; the scan limit applies when a scan starts. */
export interface ScanSettings {
  mode: FilterMode;
  minViews: number;
  sortKey: SortKey;
  sortDir: SortDir;
  /** null = All */
  scanLimit: number | null;
}

export interface ScanState<T extends ReelLike> {
  phase: Phase;
  settings: ScanSettings;
  /** The scan limit of the current or last scan. */
  scannedLimit: number | null;
  /** Reels collected so far, in grid order. */
  collected: number;
  result: FilterResult<T> | null;
}

/** Reels the replay collects per step, about one screen of Instagram's grid. The scan never passes the limit. */
export const BATCH_SIZE = 12;

/** Sort keys a snapshot can answer: it holds each Reel's views, not its likes or comments. */
export const SNAPSHOT_SORT_KEYS: readonly SortKey[] = ["views", "multiple"];

export const DEFAULT_SETTINGS: ScanSettings = {
  mode: "ratio5x",
  minViews: DEFAULT_MIN_VIEWS,
  sortKey: "views",
  sortDir: "desc",
  scanLimit: 100,
};

export function initialState<T extends ReelLike>(settings: ScanSettings = DEFAULT_SETTINGS): ScanState<T> {
  return { phase: "idle", settings, scannedLimit: settings.scanLimit, collected: 0, result: null };
}

function analyze<T extends ReelLike>(reels: readonly T[], followers: number, settings: ScanSettings, collected: number): FilterResult<T> {
  return findOutliers(reels.slice(0, collected), {
    mode: settings.mode,
    followers,
    minViews: settings.minViews,
    sortKey: settings.sortKey,
    sortDir: settings.sortDir,
  });
}

export function startScan<T extends ReelLike>(state: ScanState<T>, reels: readonly T[], followers: number): ScanState<T> {
  if (state.phase !== "idle") return state;
  const { settings } = state;
  return { ...state, phase: "scanning", scannedLimit: settings.scanLimit, collected: 0, result: analyze(reels, followers, settings, 0) };
}

export function isComplete(collected: number, scanLimit: number | null, total: number): boolean {
  return collected >= total || (scanLimit != null && collected >= scanLimit);
}

/** Collect the next batch of tiles, up to the scan limit, and re-rank everything collected so far. */
export function collectBatch<T extends ReelLike>(state: ScanState<T>, reels: readonly T[], followers: number): ScanState<T> {
  if (state.phase !== "scanning") return state;
  const cap = Math.min(reels.length, state.scannedLimit ?? reels.length);
  const collected = Math.min(cap, state.collected + BATCH_SIZE);
  const result = analyze(reels, followers, state.settings, collected);
  const phase = isComplete(collected, state.scannedLimit, reels.length) ? "done" : "scanning";
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
  return { ...state, phase: "idle", scannedLimit: state.settings.scanLimit, collected: 0, result: null };
}

/**
 * Show and Sort by re-rank the collected Reels at once, in any phase. The scan limit is locked while
 * scanning; after a scan it waits for the next one.
 */
export function updateSettings<T extends ReelLike>(
  state: ScanState<T>,
  patch: Partial<ScanSettings>,
  reels: readonly T[],
  followers: number
): ScanState<T> {
  if (state.phase === "scanning" && patch.scanLimit !== undefined) {
    patch = { ...patch };
    delete patch.scanLimit;
  }
  const settings = { ...state.settings, ...patch };
  const scannedLimit = state.phase === "idle" ? settings.scanLimit : state.scannedLimit;
  const result = state.result ? analyze(reels, followers, settings, state.collected) : null;
  return { ...state, settings, scannedLimit, result };
}

/** True after a scan when the scan limit was changed: the new one needs Reset → Run. */
export function hasPendingChanges<T extends ReelLike>(state: ScanState<T>): boolean {
  return state.phase === "done" && state.settings.scanLimit !== state.scannedLimit;
}

/** The panel's "Active threshold" (or "Showing", in All) row. */
export function activeThreshold(settings: ScanSettings, followers: number): { title: string; label: string } {
  return {
    title: settings.mode === "all" ? "Showing" : "Active threshold",
    label: thresholdLabel(settings.mode, followers, settings.minViews),
  };
}

/** The panel's progress line, worded exactly like the extension's. */
export function progressText(collected: number, scanLimit: number | null): string {
  const noun = videoNoun("instagram");
  return scanLimit != null && scanLimit > 0
    ? "Scanning… " + collected + " / " + scanLimit + " " + noun
    : "Scanning… " + collected + " " + noun + " found";
}

/** The results heading: "Outliers", or "Reels" when Show is All. */
export function resultsTitle(mode: FilterMode): string {
  return mode === "all" ? "Reels" : "Outliers";
}

/** "— 6 of 36 Reels" */
export function resultsMeta(outliers: number, collected: number): string {
  return "— " + outliers + " of " + collected + " " + videoNoun("instagram");
}

/** The extension's empty-state copy, for the current Show setting and the Reels actually collected. */
export function emptyState<T extends ReelLike>(state: ScanState<T>, followers: number): EmptyStateCopy {
  const { settings } = state;
  return buildEmptyStateCopy({
    platform: "instagram",
    filterMode: settings.mode,
    followers,
    threshold: state.result?.threshold ?? null,
    minViews: settings.mode === "minViews" ? settings.minViews : null,
    scanLimit: state.scannedLimit,
    scannedCount: state.collected,
  });
}

function reportState<T extends ReelLike>(state: ScanState<T>, followers: number) {
  const result = state.result;
  return {
    platform: "instagram" as const,
    followers,
    sortKey: result?.sortKey ?? state.settings.sortKey,
    sortDir: result?.sortDir ?? state.settings.sortDir,
    activeThresholdLabel: activeThreshold(state.settings, followers).label,
    outliers: result?.outliers ?? [],
  };
}

/** The extension's "Copy" report: a header naming the view, then "#1 | 1.4K views | 2.1×" and the URL per Reel. */
export function plainTextReport<T extends ReelLike>(state: ScanState<T>, handle: string, followers: number): string {
  return buildOutliersPlainText(reportState(state, followers), handle);
}

/** The header line over the ranked grid on the page: "6 of 36 Reels • 3,295 views • sorted by views ↓". */
export function gridMeta<T extends ReelLike>(state: ScanState<T>, followers: number): string {
  return pageGridMeta({ ...reportState(state, followers), scannedCount: state.collected });
}

/** The Sort by direction button, as the side panel labels it for count metrics. */
export function sortDirLabel(dir: SortDir): { text: string; aria: string } {
  return dir === "desc" ? { text: "↓ Highest", aria: "Highest first" } : { text: "↑ Lowest", aria: "Lowest first" };
}
