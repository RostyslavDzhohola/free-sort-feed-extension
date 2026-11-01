export type Platform = "instagram" | "tiktok";

/** Which scanned videos to show: the 5× outliers, those over a view count, or all of them. */
export type FilterMode = "ratio5x" | "minViews" | "all";

export type SortKey =
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "engagement"
  | "multiple"
  | "date"
  | "duration";

export type SortDir = "desc" | "asc";

/** How the scanned videos are filtered and ordered. Changing it never needs a rescan. */
export interface ViewSettings {
  filterMode: FilterMode;
  minViews: number;
  sortKey: SortKey;
  sortDir: SortDir;
}

/**
 * One scanned video, sent from the injected script to the side panel.
 * Counts are null when the platform doesn't show them (hidden likes, Instagram shares).
 * Entries saved by 1.0.x carry only url, href, views, ratio and thumbnailUrl.
 */
export interface OutliersEntry {
  url: string;
  href: string;
  views: number | null;
  /** Views ÷ followers; 0 when the follower count is unknown. */
  ratio: number;
  thumbnailUrl?: string | null;
  /** Absent on 1.0.x entries, which are all Instagram. */
  platform?: Platform;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  /** Unix seconds. */
  postedAt?: number | null;
  durationSec?: number | null;
  likesHidden?: boolean;
}

export interface SavedReel extends OutliersEntry {
  savedAt: string;
  profilePath: string | null;
}

/** Persisted tab state stored on window.__outliers_state (JSON-serializable). */
export interface OutliersState {
  status: "idle" | "scanning" | "done" | "error";
  phase: "scanning" | "analyzing" | "rendered";
  /** Absent on states from 1.0.x pages. */
  platform?: Platform;
  profileHandle?: string | null;
  followers: number | null;
  threshold: number | null;
  filterMode: FilterMode;
  minViews: number | null;
  sortKey?: SortKey;
  sortDir?: SortDir;
  activeThresholdLabel: string;
  scannedCount: number;
  scanLimit: number | null;
  /** The videos the current view shows, filtered and sorted. The page keeps every scanned
   * video, so the panel changes the view through __outliers_apply_view without a rescan. */
  outliers: OutliersEntry[];
  errorText: string | null;
}

/** Messages sent from injected script → side panel via chrome.runtime.sendMessage. */
export type OutliersMessage =
  | { type: "outliers:state"; state: OutliersState }
  | { type: "outliers:reset" };
