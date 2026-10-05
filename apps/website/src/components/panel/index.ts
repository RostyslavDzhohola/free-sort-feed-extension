// The panel illustration the home page tour shows. To switch to the redesigned side panel, add its
// component and data next to these (honouring the contract in ./types.ts) and repoint these exports.
// Nothing in the page or the tour needs to change.
export { default as PanelIllustration } from "./PanelIllustration.astro";
export { samplePanel, panelNotes } from "./sample-panel";
export { PANEL_ZONES } from "./types";
export type { PanelIllustrationData, PanelNote, PanelZoneId } from "./types";
