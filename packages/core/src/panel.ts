// Side panel wording, ported from apps/extension/src/sidepanel.ts and shared/platform.ts (v1.1.1).
// In the extension these read the panel's globals (the current platform and profile); here they take
// them as arguments. test/report.test.mjs lifts the originals out of the release and compares outputs.
import type { FilterMode, OutliersEntry, Platform, SortDir, SortKey } from "./types";
import {
  formatExact,
  formatMetricPhrase,
  formatMultiple,
  getThreshold,
  metricValue,
  sortLabel,
  viewsMultiple,
} from "./videos";

/** "Reels" on Instagram, "videos" on TikTok (shared/platform.ts). */
export function videoNoun(platform: Platform | null | undefined, plural = true): string {
  if (platform === "tiktok") return plural ? "videos" : "video";
  return plural ? "Reels" : "Reel";
}

export function platformName(platform: Platform | null | undefined): string {
  return platform === "tiktok" ? "TikTok" : "Instagram";
}

/** The panel's "Active threshold" (or, in All, "Showing") value: "3,295 views", "All Reels". */
export function thresholdLabel(
  mode: FilterMode,
  followers: number | null,
  minViews: number | null,
  platform: Platform | null = "instagram"
): string {
  if (mode === "all") return "All " + videoNoun(platform);
  const threshold = getThreshold(mode, followers, minViews);
  return threshold === null ? "5× follower count" : formatExact(threshold) + " views";
}

/** The scan-limit pill: "100 Reels", "All Reels" (formatScanLimitValue). */
export function formatScanLimit(limit: number | null, platform: Platform | null = "instagram"): string {
  const noun = platform === "tiktok" ? "videos" : platform === "instagram" ? "Reels" : "videos";
  return limit === null ? "All " + noun : formatExact(limit) + " " + noun;
}

/** The fields of the panel's state that its Copy report reads. */
export interface ReportState {
  platform?: Platform;
  followers: number | null;
  sortKey?: SortKey;
  sortDir?: SortDir;
  activeThresholdLabel: string;
  outliers: OutliersEntry[];
}

/** "#1 | 1.2K comments | 120K views | 4.5K likes | 12.4×", led by the metric the list is sorted by. */
export function formatOutlierLine(reel: OutliersEntry, rank: number, state: ReportState): string {
  const sortKey = state.sortKey ?? "views";
  const parts = ["#" + rank, formatMetricPhrase(sortKey, metricValue(reel, sortKey, state.followers), reel.likesHidden)];
  const platform = reel.platform ?? "instagram";
  const others: SortKey[] = platform === "tiktok"
    ? ["views", "likes", "comments", "shares", "saves"]
    : ["views", "likes", "comments"];
  for (let i = 0; i < others.length; i++) {
    const key = others[i]!;
    if (key === sortKey) continue;
    const value = metricValue(reel, key, state.followers);
    if (value !== null) parts.push(formatMetricPhrase(key, value));
  }
  const multiple = viewsMultiple(reel, state.followers);
  if (multiple !== null && sortKey !== "multiple") parts.push(formatMultiple(multiple));
  return parts.join(" | ");
}

/** "3,295 views, sorted by views ↓" */
export function describeView(state: ReportState): string {
  const sortKey = state.sortKey ?? "views";
  return state.activeThresholdLabel + ", sorted by " + sortLabel(sortKey).toLowerCase()
    + (state.sortDir === "asc" ? " ↑" : " ↓");
}

/** The panel's Copy button: a header line, then each video's line and URL. `handle` has no "@". */
export function buildOutliersPlainText(state: ReportState, handle: string | null, limit: number | null = null): string {
  const outliers = limit == null ? state.outliers : state.outliers.slice(0, Math.max(0, limit));
  const label = handle ? "@" + handle : "profile";
  const lines: string[] = [];
  lines.push("Outliers report for " + label + " on " + platformName(state.platform) + " (" + describeView(state) + ")");
  lines.push("");
  for (let i = 0; i < outliers.length; i++) {
    const reel = outliers[i]!;
    lines.push(formatOutlierLine(reel, i + 1, state));
    lines.push(reel.url);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** The page grid's header line: "6 of 36 Reels • 3,295 views • sorted by views ↓" (injected.ts). */
export function pageGridMeta(state: ReportState & { scannedCount: number }): string {
  const sortKey = state.sortKey ?? "views";
  return state.outliers.length + " of " + state.scannedCount + " " + videoNoun(state.platform)
    + " • " + state.activeThresholdLabel
    + " • sorted by " + sortLabel(sortKey).toLowerCase() + (state.sortDir === "asc" ? " ↑" : " ↓");
}
