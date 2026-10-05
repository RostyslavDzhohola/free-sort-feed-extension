// Data contract for the side panel illustration in the home page tour (DESIGN-SPEC §6.3).
//
// Any panel illustration (today's v1.0.7 panel, or the redesign) must:
//   1. render a root element with role="img" and an aria-label describing it;
//   2. wrap each annotated area in an element with data-zone="<PanelZoneId>" and class "sp-zone"
//      (or its own zone class with an `.active` style), and put <Pin n={id} /> inside it.
// The tour toggles `.active` on [data-zone] and [data-note] elements; it never reads panel internals.

export type PanelZoneId = 1 | 2 | 3 | 4 | 5;

/** What each numbered pin points at, in pin order. */
export const PANEL_ZONES: Record<PanelZoneId, string> = {
  1: "Active threshold",
  2: "Scan limit",
  3: "Filter mode",
  4: "Ranked results",
  5: "Export & copy",
};

export interface Toggle {
  label: string;
  active: boolean;
}

export interface PanelResultRow {
  rank: number;
  views: string;
  ratio: string;
}

export interface PanelIllustrationData {
  /** Accessible description of the whole illustration. */
  alt: string;
  /** Visible caption under the illustration. Must say it's sample data (DESIGN-SPEC §2.4). */
  caption: string;
  title: string;
  tagline: string;
  tabs: Toggle[];
  threshold: { label: string; value: string };
  /** position: 0–1 along the slider track. */
  scanLimit: { label: string; value: string; position: number };
  filterMode: { label: string; options: Toggle[] };
  /** The main action button as shown after a scan (v1.0.7: "Reset"). */
  actionLabel: string;
  results: {
    title: string;
    summary: string;
    tools: string[];
    rows: PanelResultRow[];
    rowActions: string[];
  };
}

/** A tour note. body is trusted, static HTML. */
export interface PanelNote {
  zone: PanelZoneId;
  title: string;
  body: string;
}
