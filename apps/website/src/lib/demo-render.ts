// HTML for Reel tiles and result rows. Shared by the server render and the demo island so both agree.
// Values come from snapshot JSON, so everything interpolated is escaped.
import { formatCount, formatExact, formatMetricPhrase, formatMultiple, metricValue, type SortKey } from "@outliers/core";
import { coverStyle } from "../data/covers";
import { initialsFor } from "../data/demo/initials";

export interface TileReel {
  url: string;
  views: number;
  viewsText?: string;
  thumb: string | null;
}

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const LINK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.59 13.41a1 1 0 0 1 0-1.41l3.3-3.3a2 2 0 1 1 2.83 2.83l-1.3 1.3a1 1 0 0 0 1.42 1.41l1.3-1.29a4 4 0 1 0-5.66-5.66l-3.3 3.3a3 3 0 0 0 4.24 4.24l1.06-1.06a1 1 0 1 0-1.42-1.41L12 13.43a1 1 0 0 1-1.41-.02z"/><path d="M13.41 10.59a1 1 0 0 1 0 1.41l-3.3 3.3a2 2 0 1 1-2.83-2.83l1.3-1.3a1 1 0 0 0-1.42-1.41l-1.3 1.29a4 4 0 1 0 5.66 5.66l3.3-3.3a3 3 0 1 0-4.24-4.24L9.52 10.23a1 1 0 0 0 1.42 1.41L12 10.57a1 1 0 0 1 1.41.02z"/></svg>';
const SCRIBBLE =
  '<svg class="scribble" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true"><path d="M16 31 C 9 13, 52 3, 82 9 S 101 37, 74 45 S 17 47, 11 27"/></svg>';

export interface TileRank {
  rank: number;
  /** Views ÷ followers. The page grid badges only multiples of 1× or more, like the extension. */
  ratio: number;
  /** The headline under the thumbnail: the sorted metric, e.g. "1.2K views". Defaults to the view count. */
  label?: string;
  /** Draw the hand-drawn ellipse around the multiple (hero before/after). */
  circled?: boolean;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Inside the round avatar: the profile photo, or initials when the snapshot has none. */
export function avatarHtml(handle: string, src: string | null): string {
  return src ? `<img src="${escapeHtml(src)}" alt="" width="38" height="38" decoding="async">` : escapeHtml(initialsFor(handle));
}

/** Where a replay ends: any limit works, but a scan stops at the snapshot's last Reel. */
export function limitNote(kind: "real" | "sample", captured: number): string {
  return kind === "sample" ? `Sample profile with ${captured} Reels` : `This snapshot holds the ${captured} most recent Reels`;
}

/**
 * A Reels-grid tile: thumbnail (or a gradient cover for the fictional sample) and its view count.
 * Ranked, it's a card from the extension's page grid: rank, the multiple badge, and the sorted metric.
 */
export function tileHtml(reel: TileReel, index: number, assetBase: string, ranked?: TileRank): string {
  const views = escapeHtml(reel.viewsText ?? formatCount(reel.views));
  const media = reel.thumb
    ? `<img src="${escapeHtml(assetBase + reel.thumb)}" alt="" loading="lazy" decoding="async" width="360" height="480">`
    : "";
  const badge = ranked && ranked.ratio >= 1 ? `<span class="rt">${escapeHtml(formatMultiple(ranked.ratio))}${ranked.circled ? SCRIBBLE : ""}</span>` : "";
  const label = ranked ? `<span class="tp">${escapeHtml(ranked.label ?? formatMetricPhrase("views", reel.views))}</span>` : "";
  const rank = ranked ? `<span class="rk">#${ranked.rank}</span>` : "";
  const cls = ["tile", reel.thumb ? "has-thumb" : "", ranked ? "ranked" : "", ranked?.circled ? "circled" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}" style="${coverStyle(index)}">${media}${rank}${badge}${label}<span class="tv">${PLAY}${views}</span></div>`;
}

export interface RowReel {
  url: string;
  views: number;
  thumb: string | null;
}

/**
 * A side panel result row, laid out like the extension's: rank, thumbnail, the sorted metric as the
 * headline, then the numbers the snapshot holds (views and views ÷ followers, the sorted one
 * highlighted), and Open / Copy link for the real Reel.
 */
export function resultRowHtml(reel: RowReel, rank: number, sortKey: SortKey, followers: number, assetBase: string): string {
  const url = escapeHtml(reel.url);
  const entry = { url: reel.url, views: reel.views, ratio: followers > 0 ? reel.views / followers : 0 };
  const primary = formatMetricPhrase(sortKey, metricValue(entry, sortKey, followers));
  const multiple = metricValue(entry, "multiple", followers);
  const thumb = reel.thumb
    ? `<img class="t" src="${escapeHtml(assetBase + reel.thumb)}" alt="" loading="lazy" decoding="async" width="44" height="66">`
    : `<span class="t" aria-hidden="true"></span>`;
  const chips =
    `<span class="c${sortKey === "views" ? " on" : ""}" title="${escapeHtml(formatExact(reel.views))} views">${PLAY}${formatCount(reel.views)}</span>` +
    (multiple === null ? "" : `<span class="c m${sortKey === "multiple" ? " on" : ""}" title="Views ÷ followers">${escapeHtml(formatMultiple(multiple))}</span>`);
  return (
    `<li><span class="r">#${rank}</span>${thumb}` +
    `<span class="i"><span class="p">${escapeHtml(primary)}</span><span class="cs">${chips}</span></span>` +
    `<span class="a"><a class="sp-act sp-open" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Open Reel #${rank} on Instagram (new tab)">Open</a>` +
    `<button class="sp-act sp-link" type="button" data-copy-url="${url}" aria-label="Copy link to Reel #${rank}" title="Copy a link">${LINK}</button></span></li>`
  );
}
