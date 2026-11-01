import type { FilterMode, Platform } from "../types/state";

interface EmptyStateCopyInput {
  platform?: Platform | null;
  filterMode: FilterMode;
  followers: number | null;
  threshold: number | null;
  minViews: number | null;
  scanLimit: number | null;
  /** How many videos the scan collected; the limit alone overstates a short profile. */
  scannedCount?: number | null;
}

export interface EmptyStateCopy {
  title: string;
  detail: string;
  status: string;
}

function formatExact(n: number): string {
  return n.toLocaleString("en-US");
}

function nouns(platform: Platform | null | undefined): { plural: string; singular: string } {
  return platform === "tiktok"
    ? { plural: "videos", singular: "video" }
    : { plural: "Reels", singular: "Reel" };
}

function getScanLimitHint(input: EmptyStateCopyInput, plural: string): string {
  const { scanLimit, scannedCount } = input;
  if (scanLimit == null) return "";
  if (scannedCount != null && scannedCount < scanLimit) return "";
  return " Scanned the first " + formatExact(scanLimit) + " " + plural + " only.";
}

export function buildEmptyStateCopy(input: EmptyStateCopyInput): EmptyStateCopy {
  const { filterMode, followers, threshold, minViews } = input;
  const { plural, singular } = nouns(input.platform);
  const scanLimitHint = getScanLimitHint(input, plural);

  if (filterMode === "all") {
    return {
      title: "No " + plural + " found.",
      detail: "Outliers couldn’t read any " + plural + " on this page. Scroll the profile so its grid loads, then run the scan again.",
      status: "",
    };
  }

  if (filterMode === "minViews") {
    const activeMinViews = minViews ?? threshold ?? 10_000;
    return {
      title: "No " + plural + " hit your minimum views filter.",
      detail: "Current minimum: " + formatExact(activeMinViews) + " views. Lower Min Views, or pick All to see every " + singular + " sorted." + scanLimitHint,
      status: "",
    };
  }

  if (followers && threshold) {
    return {
      title: "No " + plural + " hit the 5× filter.",
      detail: "This profile has " + formatExact(followers) + " followers, so a " + singular + " needs " + formatExact(threshold) + "+ views. Switch to Min Views or All to see more." + scanLimitHint,
      status: "",
    };
  }

  return {
    title: "The 5× filter needs a follower count.",
    detail: "Outliers couldn’t read this profile’s followers. Switch to Min Views or All to see its " + plural + "." + scanLimitHint,
    status: "",
  };
}
