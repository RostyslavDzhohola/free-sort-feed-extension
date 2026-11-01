// Which demo profiles the site shows. Add a profile by dropping its folder into src/data/demo/<handle>/
// (and its thumbnails into public/demo/<handle>/), then listing it in profiles.json.
import entries from "./profiles.json";
import type { DemoProfile, ProfileEntry, Snapshot } from "./types";
import { SHOW_PENDING_DEMO_PROFILES } from "../../../site.config.mjs";

const snapshots = import.meta.glob<Snapshot>("./*/snapshot.json", { eager: true, import: "default" });

/** Pending profiles render in `astro dev` (with a "Permission pending" badge) but never in a production build. */
export const showPending: boolean = import.meta.env.DEV || SHOW_PENDING_DEMO_PROFILES;

/**
 * The capture's calendar date where it was taken: "2026-10-04T22:25:51-05:00" -> "Oct 4, 2026".
 * Prefer capturedAtLocal, since capturedAt may be UTC and already on the next day.
 */
export function formatCaptureDate(snapshot: Pick<Snapshot, "capturedAt" | "capturedAtLocal">): string {
  const [y, m, d] = (snapshot.capturedAtLocal ?? snapshot.capturedAt).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function load(entry: ProfileEntry): DemoProfile {
  const snapshot = snapshots[`./${entry.handle}/snapshot.json`];
  if (!snapshot) throw new Error(`Missing src/data/demo/${entry.handle}/snapshot.json`);
  if (snapshot.handle !== entry.handle) throw new Error(`snapshot.json handle "${snapshot.handle}" doesn't match "${entry.handle}"`);
  return { ...entry, snapshot, assetBase: `/demo/${entry.handle}/`, capturedLabel: formatCaptureDate(snapshot) };
}

const visible = (entries as ProfileEntry[]).filter((e) => e.permission === "granted" || showPending).map(load);
const sample = visible.find((p) => p.kind === "sample");
const real = visible.filter((p) => p.kind === "real");

/** Profiles in the demo switcher: the real ones, featured first. The fictional sample is only a fallback. */
export const demoProfiles: DemoProfile[] = real.length > 0 ? [...real].sort((a, b) => Number(!!b.featured) - Number(!!a.featured)) : sample ? [sample] : [];

/** Profile behind the hero before/after: the one flagged `hero`, else the sample. */
export const heroProfile: DemoProfile = real.find((p) => p.hero) ?? sample ?? demoProfiles[0]!;

/** The fictional profile, for small illustrations that need a number (e.g. the Setup step). */
export const sampleProfile: DemoProfile | undefined = sample;
