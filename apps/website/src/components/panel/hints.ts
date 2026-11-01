// The five annotations from the old "side panel, annotated" chapter, now hover/focus hints on the demo panel.
import type { PanelHint } from "./types";

export const panelHints: PanelHint[] = [
  {
    zone: 1,
    title: "The bar, stated plainly",
    body: "Once followers load, the panel shows the exact view count a Reel needs. In 5× mode that's five times the follower count.",
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
    body: "Biggest first, with views and the multiple of followers. The page grid shows the same Reels. In the extension, each row can also be saved to your Library.",
  },
  {
    zone: 5,
    title: "Export & copy",
    body: "Download the run as a CSV for Sheets or Excel, or copy it as a plain-text report.",
  },
];
