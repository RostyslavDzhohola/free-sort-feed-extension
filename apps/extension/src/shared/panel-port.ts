// The port each open side panel keeps to background.ts, so a second toolbar click on that tab
// closes the panel instead of doing nothing. The port name carries the panel's tab id.
export const PANEL_PORT_PREFIX = "outliers-panel:";

export const CLOSE_PANEL_MESSAGE = "outliers:close-panel";

export function panelPortName(tabId: number): string {
  return PANEL_PORT_PREFIX + tabId;
}

/** The tab id in a panel port's name, or null when the port isn't a panel's. */
export function panelPortTabId(name: string): number | null {
  if (!name.startsWith(PANEL_PORT_PREFIX)) return null;
  const id = Number(name.slice(PANEL_PORT_PREFIX.length));
  return Number.isInteger(id) && id >= 0 ? id : null;
}
