// Background service worker — opens the side panel when the toolbar icon is clicked.
import { startHotReload } from "./hot-reload";

declare const __OUTLIERS_WATCH__: boolean;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

if (__OUTLIERS_WATCH__) {
  startHotReload();
}
