// The website's entry point to the extension's rule: take Reels in grid order, keep the first
// `scanLimit` (the 1.1 scan stops at exactly the limit), then filter and sort them with selectVideos(),
// as the extension's injected script does in buildState().
import { thresholdLabel } from "./panel";
import type { FilterMode, OutliersEntry, Platform, SortDir, SortKey } from "./types";
import { DEFAULT_MIN_VIEWS, getThreshold, resolveSortKey, selectVideos } from "./videos";

export interface ReelLike {
  url: string;
  views: number;
}

export type RankedReel<T extends ReelLike> = T & OutliersEntry & { ratio: number };

export interface FilterOptions {
  mode: FilterMode;
  /** The profile's follower count; null when it couldn't be read (5× then shows nothing). */
  followers: number | null;
  /** Used in minViews mode; falls back to DEFAULT_MIN_VIEWS when missing or <= 0. */
  minViews?: number | null;
  sortKey?: SortKey;
  sortDir?: SortDir;
  /** How many Reels (in grid order) were scanned. null = all. */
  scanLimit?: number | null;
  platform?: Platform;
}

export interface FilterResult<T extends ReelLike> {
  mode: FilterMode;
  followers: number | null;
  /** The view count a video needs, or null when every video shows (All) or 5× has no followers. */
  threshold: number | null;
  thresholdLabel: string;
  sortKey: SortKey;
  sortDir: SortDir;
  scannedCount: number;
  outliers: RankedReel<T>[];
}

/** Filter and sort reels (given in grid order, newest first) the way the extension does. */
export function findOutliers<T extends ReelLike>(reels: readonly T[], opts: FilterOptions): FilterResult<T> {
  const platform = opts.platform ?? "instagram";
  const followers = opts.followers && opts.followers > 0 ? opts.followers : null;
  const limit = opts.scanLimit == null ? reels.length : Math.min(opts.scanLimit, reels.length);
  const minViews = opts.minViews && opts.minViews > 0 ? opts.minViews : DEFAULT_MIN_VIEWS;
  const sortKey = resolveSortKey(opts.sortKey ?? "views", platform);
  const sortDir = opts.sortDir ?? "desc";
  const entries = reels.slice(0, limit).map((r) => ({
    ...r,
    platform,
    ratio: followers && Number.isFinite(r.views) ? r.views / followers : 0,
  }));
  const outliers = selectVideos(entries, { filterMode: opts.mode, minViews, sortKey, sortDir }, followers) as RankedReel<T>[];
  return {
    mode: opts.mode,
    followers,
    threshold: getThreshold(opts.mode, followers, minViews),
    thresholdLabel: thresholdLabel(opts.mode, followers, minViews, platform),
    sortKey,
    sortDir,
    scannedCount: limit,
    outliers,
  };
}
