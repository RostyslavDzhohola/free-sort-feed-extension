import type { OutliersState, ScanSnapshot, ViewSettings } from "./state";

export {};

declare global {
  interface Window {
    __outliers_active: boolean;
    __outliers_reset: (() => void) | undefined;
    __outliers_stop: (() => void) | undefined;
    __outliers_apply_view: ((view: ViewSettings) => void) | undefined;
    __outliers_scan_limit: number | null | undefined;
    __outliers_view: ViewSettings | undefined;
    /** The profile the panel read just before Run; its count applies only to that handle. */
    __outliers_profile: { handle: string; followers: number | null } | undefined;
    __outliers_state: OutliersState | undefined;
    __outliers_bridge: string | undefined;
    /** The finished scan, for the panel to keep before the page moves to another profile. */
    __outliers_snapshot: (() => ScanSnapshot | null) | undefined;
    /** Set by the panel before injecting: rebuild this scan instead of scrolling for a new one. */
    __outliers_restore: ScanSnapshot | undefined;
  }
}
