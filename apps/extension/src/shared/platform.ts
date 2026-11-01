import type { Platform } from "../types/state";

/** The profile a page belongs to: instagram.com/<handle>/… or tiktok.com/@<handle>. */
export interface ProfileRef {
  platform: Platform;
  /** Lowercase, without the @. */
  handle: string;
}

export const TIKTOK_ORIGINS = ["*://*.tiktok.com/*"];

const INSTAGRAM_RESERVED = ["explore", "p", "stories", "direct", "accounts", "reel", "reels", "tv"];

export function detectPlatform(url: string): Platform | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    return null;
  } catch {
    return null;
  }
}

function pathParts(url: string): string[] {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

/** A single video's page: an Instagram reel or post, or a TikTok video or photo post. */
export function isContentPermalink(url: string): boolean {
  const platform = detectPlatform(url);
  const parts = pathParts(url);
  if (platform === "instagram") {
    return parts.some(function (part) {
      return /^(reel|reels|p)$/i.test(part);
    }) && !(parts.length === 2 && parts[1]!.toLowerCase() === "reels");
  }
  if (platform === "tiktok") {
    return parts.length >= 3 && /^@/.test(parts[0]!) && /^(video|photo)$/i.test(parts[1]!);
  }
  return false;
}

/** The profile the URL shows, or null for anything that isn't a profile page. */
export function getProfileRef(url: string): ProfileRef | null {
  const platform = detectPlatform(url);
  const parts = pathParts(url);
  if (parts.length === 0 || isContentPermalink(url)) return null;
  if (platform === "instagram") {
    const first = parts[0]!.toLowerCase();
    if (INSTAGRAM_RESERVED.includes(first)) return null;
    return { platform, handle: first };
  }
  if (platform === "tiktok") {
    const first = parts[0]!;
    if (!/^@[^/]+$/.test(first)) return null;
    return { platform, handle: decodeURIComponent(first.slice(1)).toLowerCase() };
  }
  return null;
}

export function profileKey(ref: ProfileRef | null): string | null {
  return ref ? ref.platform + ":" + ref.handle : null;
}

export function profileLabel(ref: ProfileRef | null): string {
  return ref ? "@" + ref.handle : "profile";
}

export function profileUrl(ref: ProfileRef): string {
  return ref.platform === "tiktok"
    ? "https://www.tiktok.com/@" + ref.handle
    : "https://www.instagram.com/" + ref.handle + "/";
}

/** True on the page Outliers scans: Instagram's Reels tab, or a TikTok profile. */
export function isScanPage(url: string): boolean {
  const ref = getProfileRef(url);
  if (!ref) return false;
  if (ref.platform === "tiktok") return pathParts(url).length === 1;
  const parts = pathParts(url);
  return parts.length === 2 && parts[1]!.toLowerCase() === "reels";
}

/** The creator's profile URL from a video URL, e.g. instagram.com/natgeo/reel/X → instagram.com/natgeo/. */
export function getProfileUrlFromVideoUrl(videoUrl: string): string | null {
  const platform = detectPlatform(videoUrl);
  const parts = pathParts(videoUrl);
  if (platform === "tiktok") {
    if (parts.length >= 1 && /^@/.test(parts[0]!)) return "https://www.tiktok.com/" + parts[0];
    return null;
  }
  if (platform === "instagram") {
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!.toLowerCase();
      if (part === "reel" || part === "reels" || part === "p") {
        return "https://www.instagram.com/" + parts[i - 1]!.replace(/^@/, "") + "/";
      }
    }
  }
  return null;
}

/** "Reels" on Instagram, "videos" on TikTok. */
export function videoNoun(platform: Platform | null | undefined, plural = true): string {
  if (platform === "tiktok") return plural ? "videos" : "video";
  return plural ? "Reels" : "Reel";
}

export function platformName(platform: Platform | null | undefined): string {
  return platform === "tiktok" ? "TikTok" : "Instagram";
}
