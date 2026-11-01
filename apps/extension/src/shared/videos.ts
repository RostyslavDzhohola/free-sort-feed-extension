import type {
  FilterMode,
  OutliersEntry,
  Platform,
  SortDir,
  SortKey,
  ViewSettings,
} from "../types/state";

export const OUTLIER_MULTIPLIER = 5;
export const DEFAULT_MIN_VIEWS = 10_000;

export const DEFAULT_VIEW: ViewSettings = {
  filterMode: "ratio5x",
  minViews: DEFAULT_MIN_VIEWS,
  sortKey: "views",
  sortDir: "desc",
};

export interface SortOption {
  key: SortKey;
  label: string;
  /** Platforms whose profile grids expose this number. */
  platforms: Platform[];
}

const BOTH: Platform[] = ["instagram", "tiktok"];

export const SORT_OPTIONS: SortOption[] = [
  { key: "views", label: "Views", platforms: BOTH },
  { key: "likes", label: "Likes", platforms: BOTH },
  { key: "comments", label: "Comments", platforms: BOTH },
  { key: "shares", label: "Shares", platforms: ["tiktok"] },
  { key: "saves", label: "Saves", platforms: ["tiktok"] },
  { key: "engagement", label: "Engagement rate", platforms: BOTH },
  { key: "multiple", label: "Views ÷ followers", platforms: BOTH },
  { key: "date", label: "Post date", platforms: ["tiktok"] },
  { key: "duration", label: "Length", platforms: ["tiktok"] },
];

export function isSortKey(value: unknown): value is SortKey {
  return SORT_OPTIONS.some(function (o) {
    return o.key === value;
  });
}

export function isFilterMode(value: unknown): value is FilterMode {
  return value === "ratio5x" || value === "minViews" || value === "all";
}

export function sortOptionsFor(platform: Platform | null | undefined): SortOption[] {
  const p = platform ?? "instagram";
  return SORT_OPTIONS.filter(function (o) {
    return o.platforms.includes(p);
  });
}

/** The sort key to use on this platform; keys it can't read fall back to views. */
export function resolveSortKey(key: SortKey, platform: Platform | null | undefined): SortKey {
  return sortOptionsFor(platform).some(function (o) {
    return o.key === key;
  })
    ? key
    : "views";
}

export function sortLabel(key: SortKey): string {
  return SORT_OPTIONS.find(function (o) {
    return o.key === key;
  })?.label ?? "Views";
}

function known(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Likes, comments, shares and saves per view. Null unless views, likes and comments are known. */
export function engagementRate(v: OutliersEntry): number | null {
  if (!known(v.views) || v.views <= 0 || !known(v.likes) || !known(v.comments)) return null;
  const interactions = v.likes + v.comments + (known(v.shares) ? v.shares : 0) + (known(v.saves) ? v.saves : 0);
  return interactions / v.views;
}

/** Views ÷ followers, from the live follower count or the ratio stored with the entry. */
export function viewsMultiple(v: OutliersEntry, followers: number | null): number | null {
  if (!known(v.views)) return null;
  if (followers && followers > 0) return v.views / followers;
  return v.ratio > 0 ? v.ratio : null;
}

export function metricValue(v: OutliersEntry, key: SortKey, followers: number | null): number | null {
  switch (key) {
    case "views":
      return known(v.views) ? v.views : null;
    case "likes":
      return known(v.likes) ? v.likes : null;
    case "comments":
      return known(v.comments) ? v.comments : null;
    case "shares":
      return known(v.shares) ? v.shares : null;
    case "saves":
      return known(v.saves) ? v.saves : null;
    case "engagement":
      return engagementRate(v);
    case "multiple":
      return viewsMultiple(v, followers);
    case "date":
      return known(v.postedAt) ? v.postedAt : null;
    case "duration":
      return known(v.durationSec) ? v.durationSec : null;
  }
}

/** The view count a video needs to show, or null when every video shows. */
export function getThreshold(
  mode: FilterMode,
  followers: number | null,
  minViews: number | null
): number | null {
  if (mode === "all") return null;
  if (mode === "minViews") return minViews && minViews > 0 ? minViews : DEFAULT_MIN_VIEWS;
  return followers && followers > 0 ? followers * OUTLIER_MULTIPLIER : null;
}

function compareForSort(
  a: OutliersEntry,
  b: OutliersEntry,
  key: SortKey,
  dir: SortDir,
  followers: number | null
): number {
  const av = metricValue(a, key, followers);
  const bv = metricValue(b, key, followers);
  // Unknown values (hidden likes, unreadable counts) sort last in either direction.
  if (av === null && bv !== null) return 1;
  if (bv === null && av !== null) return -1;
  if (av !== null && bv !== null && av !== bv) return dir === "desc" ? bv - av : av - bv;
  const aViews = known(a.views) ? a.views : -1;
  const bViews = known(b.views) ? b.views : -1;
  if (aViews !== bViews) return bViews - aViews;
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
}

/** Filter the scanned videos by the view's mode and order them by its sort key. */
export function selectVideos(
  videos: OutliersEntry[],
  view: ViewSettings,
  followers: number | null
): OutliersEntry[] {
  const threshold = getThreshold(view.filterMode, followers, view.minViews);
  const list = videos.filter(function (v) {
    if (view.filterMode === "all") return true;
    if (threshold === null) return false;
    return known(v.views) && v.views >= threshold;
  });
  return list.sort(function (a, b) {
    return compareForSort(a, b, view.sortKey, view.sortDir, followers);
  });
}

// ── Formatting ─────────────────────────────────────────────────────────────
export function formatExact(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCount(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}

export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 10) return pct.toFixed(0) + "%";
  if (pct >= 1) return pct.toFixed(1).replace(/\.0$/, "") + "%";
  return pct.toFixed(2).replace(/0$/, "") + "%";
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ":" + String(s).padStart(2, "0");
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMultiple(multiple: number): string {
  if (multiple >= 100) return Math.round(multiple) + "×";
  if (multiple >= 1) return multiple.toFixed(1) + "×";
  // Big accounts land well under 1×; keep enough digits to tell 0.01× from 0.4×.
  return (multiple >= 0.01 ? multiple.toFixed(2) : multiple.toPrecision(1)) + "×";
}

/** The value of a metric as shown on a result, e.g. "1.2K", "4.1%", "Oct 3, 2026", or "—". */
export function formatMetricValue(key: SortKey, value: number | null): string {
  if (value === null) return "—";
  switch (key) {
    case "engagement":
      return formatPercent(value);
    case "multiple":
      return formatMultiple(value);
    case "date":
      return formatDate(value);
    case "duration":
      return formatDuration(value);
    default:
      return formatCount(value);
  }
}

/**
 * The metric with its unit, e.g. "1.2K comments", "1 share", "4.1% engagement", "posted Oct 3, 2026".
 * `likesHidden` says the creator hid the like count; otherwise a missing count is just not shown.
 */
export function formatMetricPhrase(key: SortKey, value: number | null, likesHidden = false): string {
  const shown = formatMetricValue(key, value);
  const unit = function (singular: string): string {
    return shown + " " + singular + (value === 1 ? "" : "s");
  };
  switch (key) {
    case "views":
      return unit("view");
    case "likes":
      if (value !== null) return unit("like");
      return likesHidden ? "likes hidden" : "likes not shown";
    case "comments":
      return unit("comment");
    case "shares":
      return unit("share");
    case "saves":
      return unit("save");
    case "engagement":
      return shown + " engagement";
    case "multiple":
      return value === null ? "— × followers" : shown + " followers";
    case "date":
      return value === null ? "date unknown" : "posted " + shown;
    case "duration":
      return shown + " long";
  }
}
