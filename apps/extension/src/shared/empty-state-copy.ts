import type { FilterMode } from "../types/state";

interface EmptyStateCopyInput {
  filterMode: FilterMode;
  followers: number | null;
  threshold: number | null;
  minViews: number | null;
  scanLimit: number | null;
}

export interface EmptyStateCopy {
  title: string;
  detail: string;
  status: string;
}

function formatExact(n: number): string {
  return n.toLocaleString("en-US");
}

function getScanLimitHint(scanLimit: number | null): string {
  if (scanLimit == null) return "";
  return " Scanned: first " + formatExact(scanLimit) + " reels only.";
}

export function buildEmptyStateCopy(input: EmptyStateCopyInput): EmptyStateCopy {
  const { filterMode, followers, threshold, minViews, scanLimit } = input;
  const scanLimitHint = getScanLimitHint(scanLimit);

  if (filterMode === "minViews") {
    const activeMinViews = minViews ?? threshold ?? 10_000;
    return {
      title: "No Reels hit your minimum views filter.",
      detail: "Current minimum: " + formatExact(activeMinViews) + " views. Lower Min Views or raise the scan limit to see more." + scanLimitHint,
      status: "",
    };
  }

  if (followers && threshold) {
    return {
      title: "No Reels hit the 5× filter.",
      detail: "This profile has " + formatExact(followers) + " followers, so a Reel needs " + formatExact(threshold) + "+ views. Switch to Min Views or raise the scan limit to see more." + scanLimitHint,
      status: "",
    };
  }

  return {
    title: "No Reels hit the 5× filter.",
    detail: "5× mode compares Reel views to follower count. Switch to Min Views or raise the scan limit to see more." + scanLimitHint,
    status: "",
  };
}
