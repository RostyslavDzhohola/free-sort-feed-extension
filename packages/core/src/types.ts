// Types copied from apps/extension/src/types/state.ts (v1.1.1), narrowed to what core uses.

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
 * One scanned video. Counts are null when the platform doesn't show them (hidden likes, Instagram
 * shares). The extension's OutliersEntry also carries href and thumbnailUrl, which core never reads.
 */
export interface OutliersEntry {
  url: string;
  views: number | null;
  /** Views ÷ followers; 0 when the follower count is unknown. */
  ratio: number;
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
