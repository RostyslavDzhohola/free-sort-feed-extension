// Contract for the side panel in the home page demo (DESIGN-SPEC §6.4).
//
// The demo island (components/demo/demo-client.ts) drives the panel only through these hooks, so a
// redesigned panel can replace DemoPanel.astro as long as it renders:
//   - every element in PANEL_HOOKS (attribute names below), with the noted element types;
//   - a [data-zone="<PanelZoneId>"] wrapper around each annotated area, holding <Pin n={id} label=… />.
// The island toggles `.active` on the zone being hinted and `hidden` on elements that change with state;
// everything else about the look belongs to the panel component.
import type { FilterMode, SortDir, SortKey } from "@outliers/core";

export type PanelZoneId = 1 | 2 | 3 | 4 | 5;

/** What each numbered pin points at, in pin order. */
export const PANEL_ZONES: Record<PanelZoneId, string> = {
  1: "Profile and bar",
  2: "Scan limit",
  3: "Show and Sort by",
  4: "Results",
  5: "Export & copy",
};

export const PANEL_HOOKS = {
  handle: "data-panel-handle", // text: "@heyrostyslav"
  followers: "data-panel-followers", // text: "659"
  thresholdTitle: "data-panel-threshold-title", // text: "Active threshold" | "Showing"
  threshold: "data-panel-threshold", // text: "3,295 views" | "All Reels"
  limit: "data-panel-limit", // <input type="range"> 0–1000 (scan-limit curve)
  limitValue: "data-panel-limit-value", // text: "100 Reels"
  limitNote: "data-panel-limit-note", // text: where a replay ends ("This snapshot holds the 120 most recent Reels")
  mode: "data-panel-mode", // three buttons, value "ratio5x" | "minViews" | "all", role="radio"
  minViewsArea: "data-panel-minviews-area", // shown only in Min Views mode
  minViews: "data-panel-minviews", // <input type="range"> 0–1000 (Min Views curve)
  minViewsValue: "data-panel-minviews-value", // text: "10,000 views"
  sortKey: "data-panel-sort-key", // <select>, one <option> per sort key the snapshot can answer
  sortDir: "data-panel-sort-dir", // <button>: "↓ Highest" | "↑ Lowest"
  run: "data-panel-run", // <button>
  stop: "data-panel-stop", // <button>
  reset: "data-panel-reset", // <button>
  status: "data-panel-status", // text
  progress: "data-panel-progress", // container
  progressFill: "data-panel-progress-fill", // width set as a percentage
  progressText: "data-panel-progress-text", // text
  results: "data-panel-results", // container, hidden until the first Run
  resultsTitle: "data-panel-results-title", // text: "Outliers" | "Reels"
  meta: "data-panel-meta", // text: "— 6 of 36 Reels"
  list: "data-panel-list", // <ol>, filled with lib/demo-render resultRowHtml()
  empty: "data-panel-empty", // container for the no-results message
  emptyTitle: "data-panel-empty-title",
  emptyDetail: "data-panel-empty-detail",
  csv: "data-panel-csv", // <button>
  copy: "data-panel-copy", // <button>
} as const;

/** What the panel shows before the first scan. */
export interface PanelInitialState {
  handle: string;
  followers: string;
  thresholdTitle: string;
  thresholdLabel: string;
  mode: FilterMode;
  scanLimit: { position: number; label: string; note: string };
  minViews: { position: number; label: string };
  sort: { key: SortKey; dir: SortDir; dirLabel: string; dirAria: string; options: { key: SortKey; label: string }[]; note: string };
}

/** A hover/focus hint for one zone. body is trusted, static HTML. */
export interface PanelHint {
  zone: PanelZoneId;
  title: string;
  body: string;
}
