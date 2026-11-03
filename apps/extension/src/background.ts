// Background service worker — opens the side panel for the tab whose toolbar icon was clicked.
// The panel belongs to that tab: Chrome hides it on other tabs and shows it again on return.
import { startHotReload } from "./hot-reload";
import { SCAN_SNAPSHOT_PREFIX, keepScan } from "./shared/storage-keys";
import type { OutliersMessage } from "./types/state";

declare const __OUTLIERS_WATCH__: boolean;

// Icon clicks reach onClicked below instead of opening one panel for the whole window.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(function (err) {
  console.warn("[outliers] could not set the side panel behavior:", err);
});

chrome.action.onClicked.addListener(function (tab) {
  if (tab.id == null) return;
  // Not awaited: open() must run inside the click's user gesture, and Chrome applies the two in order.
  chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html?tab=" + tab.id, enabled: true }).catch(function (err) {
    console.warn("[outliers] could not set up the side panel:", err);
  });
  chrome.sidePanel.open({ tabId: tab.id }).catch(function (err) {
    console.warn("[outliers] could not open the side panel:", err);
  });
});

// A scan that just finished on a tab, kept there for when the tab comes back to the profile.
chrome.runtime.onMessage.addListener(function (msg: OutliersMessage, sender): undefined {
  if (msg?.type !== "outliers:keep-scan") return undefined;
  const tabId = sender.tab?.id;
  const kept = msg.snapshot;
  if (tabId == null || !kept?.handle || !Array.isArray(kept.videos) || kept.videos.length === 0) return undefined;
  keepScan(tabId, kept).catch(function () {
    // Non-fatal: the scan just isn't kept.
  });
  return undefined;
});

// Scans kept for a tab (see keepScanSnapshot in sidepanel.ts) go when the tab closes.
chrome.tabs.onRemoved.addListener(function (tabId) {
  const prefix = SCAN_SNAPSHOT_PREFIX + tabId + ":";
  chrome.storage.session.get().then(function (all) {
    const keys = Object.keys(all).filter(function (key) {
      return key.startsWith(prefix);
    });
    if (keys.length > 0) return chrome.storage.session.remove(keys);
    return undefined;
  }).catch(function () {
    // Non-fatal: session storage clears when the browser closes anyway.
  });
});

if (__OUTLIERS_WATCH__) {
  startHotReload();
}
