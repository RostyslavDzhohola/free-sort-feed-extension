// Demo labels shared by the server render (Demo.astro) and the island (demo-client.ts), so both
// always say the same thing: where the data comes from, and whose Reels they are.

export interface CopyProfile {
  handle: string;
  kind: "real" | "sample";
  permission: "pending" | "granted";
  /** The site owner's own profile. */
  owner: boolean;
  /** e.g. "Oct 4, 2026" */
  capturedLabel: string;
}

/** A third-party creator's credit: "Featured creator: <a href>@handle</a>. <detail>" */
export interface Credit {
  lead: string;
  handle: string;
  href: string;
  detail: string;
}

/**
 * Always-visible line naming the data source (DESIGN-SPEC §6.4). Says "snapshot", not "scan": a profile's
 * snapshot and the extension export that verifies it may come from different sessions (see comparison.json).
 */
export function honestyLabel(p: CopyProfile): string {
  return p.kind === "sample"
    ? `Sample data from a fictional profile, @${p.handle}.`
    : `Replay of a real snapshot captured ${p.capturedLabel}, checked against the extension's own export. Live numbers on Instagram will differ.`;
}

/**
 * Credit and disclosure for a creator whose Reels the demo replays. Only "granted" may say
 * "with permission"; pending profiles never reach production builds anyway.
 * The owner's profile and the fictional sample get none.
 */
export function creditFor(p: CopyProfile): Credit | null {
  if (p.kind !== "real" || p.owner) return null;
  const owns = `Reels, numbers and thumbnails belong to @${p.handle}`;
  return {
    lead: "Featured creator:",
    handle: p.handle,
    href: `https://www.instagram.com/${p.handle}/`,
    detail:
      p.permission === "granted"
        ? `${owns}, shown with permission. Not affiliated with Outliers.`
        : `${owns}. Permission pending: dev preview only. Not affiliated with Outliers.`,
  };
}
