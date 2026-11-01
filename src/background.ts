// Background service worker — opens the side panel for the tab whose toolbar icon was clicked.
// The panel belongs to that tab: Chrome hides it on other tabs and shows it again on return.
import { startHotReload } from "./hot-reload";

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

if (__OUTLIERS_WATCH__) {
  startHotReload();
}
