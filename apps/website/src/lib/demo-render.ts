// HTML for Reel tiles and result rows. Shared by the server render and the demo island so both agree.
// Values come from snapshot JSON, so everything interpolated is escaped.
import { formatCount, formatRatio } from "@outliers/core";
import { coverStyle } from "../data/covers";

export interface TileReel {
  url: string;
  views: number;
  viewsText?: string;
  thumb: string | null;
}

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const SCRIBBLE =
  '<svg class="scribble" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true"><path d="M16 31 C 9 13, 52 3, 82 9 S 101 37, 74 45 S 17 47, 11 27"/></svg>';

export interface TileRank {
  rank: number;
  ratio: number;
  /** Draw the hand-drawn ellipse around the multiple (hero before/after). */
  circled?: boolean;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Why the scan-limit slider stops short of All in the replay. */
export function limitNote(kind: "real" | "sample", captured: number): string {
  return kind === "sample" ? `Sample profile with ${captured} Reels` : `Snapshot of the ${captured} most recent Reels`;
}

/** A Reels-grid tile: thumbnail (or a gradient cover for the fictional sample) and its view count. */
export function tileHtml(reel: TileReel, index: number, assetBase: string, ranked?: TileRank): string {
  const views = escapeHtml(reel.viewsText ?? formatCount(reel.views));
  const media = reel.thumb
    ? `<img src="${escapeHtml(assetBase + reel.thumb)}" alt="" loading="lazy" decoding="async" width="360" height="480">`
    : "";
  const badges = ranked
    ? `<span class="rk">${ranked.rank}</span><span class="rt">${escapeHtml(formatRatio(ranked.ratio))}${ranked.circled ? SCRIBBLE : ""}</span>`
    : "";
  const cls = ["tile", reel.thumb ? "has-thumb" : "", ranked?.circled ? "circled" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}" style="${coverStyle(index)}">${media}${badges}<span class="tv">${PLAY}${views}</span></div>`;
}

/** A side panel result row: rank, views, multiple, and Open / Copy link for the real Reel. */
export function resultRowHtml(reel: { url: string; views: number; ratio: number }, rank: number): string {
  const url = escapeHtml(reel.url);
  return (
    `<li><span class="r">#${rank}</span>` +
    `<span class="i"><span class="v">${formatCount(reel.views)} views</span><span class="x">${escapeHtml(formatRatio(reel.ratio))}</span></span>` +
    `<span class="a"><a class="sp-act sp-open" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Open Reel #${rank} on Instagram (new tab)">Open</a>` +
    `<button class="sp-act" type="button" data-copy-url="${url}" aria-label="Copy link to Reel #${rank}">Copy link</button></span></li>`
  );
}
