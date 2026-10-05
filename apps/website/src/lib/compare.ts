// Account-size comparison: where the 5× bar and a Min Views bar land for a given follower count.
// Shared by the server render and the island so both produce identical output.
import { MULTIPLIER, formatCount } from "@outliers/core";

const LOG_MIN = 3; // 1K
const LOG_MAX = 7; // 10M

/** Bar length on the shared log track (1K–10M), as a CSS percentage. */
export function barWidth(views: number): string {
  const t = (Math.log10(Math.max(views, 1000)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return (Math.min(1, Math.max(0, t)) * 100).toFixed(1) + "%";
}

/** 8.333 -> "8.3×", 60.2 -> "60×", 2 -> "2×". */
export function formatTimes(x: number): string {
  return (x >= 10 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, "")) + "×";
}

export function verdict(followers: number, minViews: number): string {
  const bar5 = followers * MULTIPLIER;
  if (bar5 > minViews) {
    return `5× is the stricter bar here, ${formatTimes(bar5 / minViews)} higher. Min Views lets more Reels through.`;
  }
  if (bar5 < minViews) {
    return `Min Views is the stricter bar here, ${formatTimes(minViews / bar5)} higher. 5× lets more Reels through.`;
  }
  return "Both modes land on the same bar for this account.";
}

export interface CaseView {
  bar5Width: string;
  minWidth: string;
  bar5Label: string;
  minLabel: string;
  verdict: string;
}

export function caseView(followers: number, minViews: number): CaseView {
  const bar5 = followers * MULTIPLIER;
  return {
    bar5Width: barWidth(bar5),
    minWidth: barWidth(minViews),
    bar5Label: formatCount(bar5),
    minLabel: formatCount(minViews),
    verdict: verdict(followers, minViews),
  };
}
