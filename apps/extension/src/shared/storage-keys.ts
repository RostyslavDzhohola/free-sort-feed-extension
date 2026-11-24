// Storage keys shared by the side panel, the background and the page scanner.

/** The Library: every saved video, newest first. The side panel writes it; the scanner reads it. */
export const SAVED_REELS_KEY = "outliers_saved_reels";

/** chrome.storage.session key for a finished scan kept for one tab and profile. */
export function scanSnapshotKey(tabId: number, platform: string, handle: string): string {
  return SCAN_SNAPSHOT_PREFIX + tabId + ":" + platform + ":" + handle.toLowerCase();
}

export const SCAN_SNAPSHOT_PREFIX = "outliers_scan:";

/** At most this many kept scans across all tabs; the oldest go first. */
const MAX_KEPT_SCANS = 12;

interface KeptScanLike {
  platform: string;
  handle: string;
  savedAt: number;
}

/**
 * Keeps a finished scan for a tab in chrome.storage.session (memory only, 10 MB for the whole
 * extension). Older kept scans make room: past MAX_KEPT_SCANS, or when the write doesn't fit.
 * Resolves false when it still couldn't be kept.
 */
export async function keepScan(tabId: number, kept: KeptScanLike): Promise<boolean> {
  const key = scanSnapshotKey(tabId, kept.platform, kept.handle);
  const all = await chrome.storage.session.get();
  const others = Object.keys(all)
    .filter(function (k) {
      return k.startsWith(SCAN_SNAPSHOT_PREFIX) && k !== key;
    })
    .sort(function (a, b) {
      return ((all[a] as KeptScanLike | undefined)?.savedAt ?? 0) - ((all[b] as KeptScanLike | undefined)?.savedAt ?? 0);
    });
  const over = others.length - (MAX_KEPT_SCANS - 1);
  if (over > 0) await chrome.storage.session.remove(others.splice(0, over));
  for (;;) {
    try {
      await chrome.storage.session.set({ [key]: kept });
      return true;
    } catch {
      // Out of room: drop the oldest kept scan and try again.
      const oldest = others.shift();
      if (!oldest) return false;
      await chrome.storage.session.remove(oldest);
    }
  }
}
