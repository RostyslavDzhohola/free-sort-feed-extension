// Fictional sample profile used by every demo on the site. Always label it "sample data" where it's shown.
import { findOutliers } from "@outliers/core";

export interface SampleReel {
  id: string;
  /** Position in the Reels grid, newest first. Drives the cover colours. */
  index: number;
  views: number;
  label: string;
  url: string;
}

export const sampleProfile = {
  handle: "sample.studio",
  initials: "SS",
  followers: 18_400,
  url: "https://www.instagram.com/sample.studio/",
} as const;

// Grid order = newest first, the way Instagram's Reels tab lists them.
const seed: ReadonlyArray<readonly [number, string]> = [
  [12_800, "Desk reset"],
  [8_900, "Color notes"],
  [214_000, "Before / after"],
  [15_300, "Gear I'd rebuy"],
  [22_100, "Client reveal"],
  [6_400, "Q&A"],
  [41_700, "Lighting trick"],
  [9_800, "Studio tour"],
  [1_380_000, "One-light portrait"],
  [18_200, "Edit with me"],
  [11_100, "Moodboard"],
  [27_500, "Shot list"],
  [96_300, "Cheap backdrop hack"],
  [7_700, "Day in the studio"],
  [13_900, "Behind the scenes"],
  [58_400, "Phone vs camera"],
  [10_200, "Packing list"],
  [5_100, "Studio update"],
  [312_000, "3 framing rules"],
  [16_800, "Golden hour"],
  [24_600, "Sound design"],
  [9_300, "Retouch tips"],
  [88_900, "Window light"],
  [14_400, "Unboxing"],
  [6_900, "Prop shopping"],
  [19_700, "Lens test"],
  [141_000, "Fixing a bad shot"],
  [12_100, "Team intro"],
  [31_800, "Pricing talk"],
  [8_200, "Coffee run"],
  [10_900, "Timelapse"],
  [47_300, "Gimbal moves"],
  [4_600, "Office plants"],
  [21_300, "Workflow"],
  [520_000, "$20 light setup"],
  [13_500, "Year one"],
];

export const sampleReels: SampleReel[] = seed.map(([views, label], index) => {
  const id = "DEMO" + String(index + 1).padStart(4, "0");
  // Same shape the extension exports: /<handle>/reel/<id>/
  return { id, index, views, label, url: `${sampleProfile.url}reel/${id}/` };
});

/** A full 5× scan of the sample profile: 6 of 36 Reels clear 92,000 views. */
export const sampleRun = findOutliers(sampleReels, { mode: "ratio5x", followers: sampleProfile.followers });
