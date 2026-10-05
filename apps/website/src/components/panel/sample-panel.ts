// The v1.0.7 side panel after a 5× scan of the sample profile, plus the tour notes that describe it.
import { SCAN_SLIDER_MAX, formatCount, formatRatio, formatScanLimit, scanLimitToSliderPosition } from "@outliers/core";
import { sampleRun } from "../../data/sample";
import type { PanelIllustrationData, PanelNote } from "./types";

const SCAN_LIMIT = 100; // the extension's default

export const samplePanel: PanelIllustrationData = {
  alt: "Illustration of the Outliers side panel with sample results",
  title: "Outliers",
  tagline: "Find viral outlier Reels",
  tabs: [
    { label: "Outliers", active: true },
    { label: "Library", active: false },
  ],
  threshold: { label: "Active threshold", value: sampleRun.thresholdLabel },
  scanLimit: {
    label: "Scan limit",
    value: formatScanLimit(SCAN_LIMIT),
    position: scanLimitToSliderPosition(SCAN_LIMIT) / SCAN_SLIDER_MAX,
  },
  filterMode: {
    label: "Filter mode",
    options: [
      { label: "5× Outliers", active: true },
      { label: "Min Views", active: false },
    ],
  },
  actionLabel: "Reset",
  results: {
    title: "Outliers",
    summary: `— ${sampleRun.outliers.length} of ${sampleRun.scannedCount} reels`,
    tools: ["CSV", "Copy"],
    rows: sampleRun.outliers.slice(0, 4).map((reel, i) => ({
      rank: i + 1,
      views: formatCount(reel.views) + " views",
      ratio: formatRatio(reel.ratio),
    })),
    rowActions: ["Open", "Link", "Save"],
  },
};

export const panelNotes: PanelNote[] = [
  {
    zone: 1,
    title: "The bar, stated plainly",
    body: "Once followers load, the panel shows the exact view count a Reel needs. For a profile with 18,400 followers, that's 92,000.",
  },
  {
    zone: 2,
    title: "Scan limit",
    body: "Choose how far it scrolls, from a quick look at recent Reels to <i>All</i>. Press Stop at any point to rank what's been collected.",
  },
  {
    zone: 3,
    title: "Filter mode",
    body: "Switch between 5× Outliers and Min Views. New settings apply to your next scan after a Reset.",
  },
  {
    zone: 4,
    title: "Ranked results",
    body: "Biggest first, with views and the multiple of followers. Each row has <b>Open</b>, <b>Copy link</b> and <b>Save</b>, and the page grid shows the same Reels.",
  },
  {
    zone: 5,
    title: "Export & copy",
    body: "Download the run as a CSV for Sheets or Excel, or copy it as a plain-text report. Saved Reels collect in your <b>Library</b>.",
  },
];
