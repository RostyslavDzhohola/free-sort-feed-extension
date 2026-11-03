// chrome.storage.local keys shared by the side panel and the page scanner.

/** The Library: every saved video, newest first. The side panel writes it; the scanner reads it. */
export const SAVED_REELS_KEY = "outliers_saved_reels";

/** chrome.storage.session key for a finished scan kept for one tab and profile. */
export function scanSnapshotKey(tabId: number, platform: string, handle: string): string {
  return SCAN_SNAPSHOT_PREFIX + tabId + ":" + platform + ":" + handle.toLowerCase();
}

export const SCAN_SNAPSHOT_PREFIX = "outliers_scan:";
