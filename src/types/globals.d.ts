import type { OutliersState, ViewSettings } from "./state";

export {};

declare global {
  interface Window {
    __outliers_active: boolean;
    __outliers_reset: (() => void) | undefined;
    __outliers_stop: (() => void) | undefined;
    __outliers_apply_view: ((view: ViewSettings) => void) | undefined;
    __outliers_scan_limit: number | null | undefined;
    __outliers_view: ViewSettings | undefined;
    __outliers_followers: number | null | undefined;
    __outliers_state: OutliersState | undefined;
    __outliers_bridge: string | undefined;
  }
}
