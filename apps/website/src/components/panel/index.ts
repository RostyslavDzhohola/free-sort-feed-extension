// The side panel the home page demo shows. To switch to the redesigned panel, add its component next to
// DemoPanel.astro (honouring the contract in ./types.ts) and repoint the export below.
// Neither the demo section nor the page needs to change.
export { default as DemoPanel } from "./DemoPanel.astro";
export { panelHints } from "./hints";
export { PANEL_HOOKS, PANEL_ZONES } from "./types";
export type { PanelHint, PanelInitialState, PanelZoneId } from "./types";
