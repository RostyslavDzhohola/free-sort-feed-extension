// Demo snapshots (DESIGN-SPEC §6.4): a profile's Reels tab captured once through the extension.
// Each profile lives in src/data/demo/<handle>/ (snapshot.json, plus extension-5x.csv for real profiles);
// its thumbnails live in public/demo/<handle>/.

export interface SnapshotReel {
  shortcode: string;
  url: string;
  viewsText: string;
  views: number;
  /** Thumbnail path relative to public/demo/<handle>/ (e.g. "thumbs/ABC123.jpg"). null for the fictional sample. */
  thumb: string | null;
}

/** Grid order: newest first, as Instagram's Reels tab lists them. */
export interface Snapshot {
  handle: string;
  followersText: string;
  followers: number;
  /** ISO date or date-time of the capture. */
  capturedAt: string;
  reelCount: number;
  reels: SnapshotReel[];
}

/** One entry in profiles.json. */
export interface ProfileEntry {
  handle: string;
  /** "real" = a captured Instagram profile; "sample" = the fictional fallback. */
  kind: "real" | "sample";
  /** Third-party profiles stay out of production builds until the creator agrees to be featured. */
  permission: "pending" | "granted";
  /** Selected first in the demo. */
  featured?: boolean;
  /** Used by the hero before/after. */
  hero?: boolean;
  /** The site owner's own profile: no "Featured with permission" label needed. */
  owner?: boolean;
}

export interface DemoProfile extends ProfileEntry {
  snapshot: Snapshot;
  /** Public URL prefix for this profile's thumbnails. */
  assetBase: string;
  /** e.g. "Oct 5, 2026" */
  capturedLabel: string;
}
