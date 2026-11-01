// The outlier rule, mirroring analyzeFromMap() in apps/extension/src/injected.ts:
// keep Reels with views >= threshold, rank by views (descending), ratio = views / followers.

import { formatExact } from "./count";

export type FilterMode = "ratio5x" | "minViews";

export const MULTIPLIER = 5;
export const DEFAULT_MIN_VIEWS = 10_000;

export interface ReelLike {
  url: string;
  views: number;
}

export type RankedReel<T extends ReelLike> = T & { ratio: number };

export interface FilterOptions {
  mode: FilterMode;
  followers: number;
  /** Used in minViews mode; falls back to DEFAULT_MIN_VIEWS when missing or <= 0. */
  minViews?: number | null;
  /** How many Reels (in grid order) were scanned. null = all. */
  scanLimit?: number | null;
}

export interface FilterResult<T extends ReelLike> {
  mode: FilterMode;
  followers: number;
  threshold: number;
  thresholdLabel: string;
  scannedCount: number;
  outliers: RankedReel<T>[];
}

export function thresholdFor(mode: FilterMode, followers: number, minViews?: number | null): number {
  if (mode === "minViews") return minViews && minViews > 0 ? minViews : DEFAULT_MIN_VIEWS;
  return followers * MULTIPLIER;
}

/** "92,000 views" — the label the side panel shows as the active threshold. */
export function thresholdLabel(threshold: number): string {
  return formatExact(threshold) + " views";
}

/** Filter and rank reels (given in grid order, newest first) the way the extension does. */
export function findOutliers<T extends ReelLike>(reels: readonly T[], opts: FilterOptions): FilterResult<T> {
  const limit = opts.scanLimit == null ? reels.length : Math.min(opts.scanLimit, reels.length);
  const scanned = reels.slice(0, limit).filter((r) => !isNaN(r.views));
  const threshold = thresholdFor(opts.mode, opts.followers, opts.minViews);
  const outliers = scanned
    .filter((r) => r.views >= threshold)
    .sort((a, b) => b.views - a.views)
    .map((r) => ({ ...r, ratio: r.views / opts.followers }));
  return {
    mode: opts.mode,
    followers: opts.followers,
    threshold,
    thresholdLabel: thresholdLabel(threshold),
    scannedCount: limit,
    outliers,
  };
}
