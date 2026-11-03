// The five annotations on the demo panel, shown on hover/focus. They describe the 1.1 side panel
// (v1.1.1, the store version); copy rules are in DESIGN-SPEC §2.
import type { PanelHint } from "./types";

export const panelHints: PanelHint[] = [
  {
    zone: 1,
    title: "The profile and its bar",
    body: "The panel reads the profile's follower count and states the exact view count a Reel needs. In 5× Outliers that's five times the followers. Min Views and All work without a follower count.",
  },
  {
    zone: 2,
    title: "Scan limit",
    body: "Choose how far it scrolls, from a quick look at recent Reels to <i>All</i>. The scan stops at exactly that many, and Stop ranks what's been collected. A new limit applies to the next scan, after Reset.",
  },
  {
    zone: 3,
    title: "Show and Sort by",
    body: "Show 5× Outliers, the Reels over a Min Views bar, or All of them, and sort highest or lowest first. Both apply at once, even mid-scan, without scanning again. The extension also sorts by likes, comments and engagement rate (and on TikTok, shares, saves, post date and length); this snapshot holds views only.",
  },
  {
    zone: 4,
    title: "Results",
    body: "Each Reel with the number it's sorted by up front, then its views and multiple of followers. The page shows the same list as a grid of cards. In the extension, each row can also be saved to your Library.",
  },
  {
    zone: 5,
    title: "Export & copy",
    body: "Download the list as a CSV with every metric for Sheets or Excel, or copy it as a plain-text report. The extension's Share button also makes a story card and copies a caption or the top 5 links.",
  },
];
