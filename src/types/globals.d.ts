import type { OutliersState } from "./state";

export {};

declare global {
  interface Window {
    __outliers_active: boolean;
    __outliers_reset: (() => void) | undefined;
    __outliers_stop: (() => void) | undefined;
    __outliers_scan_limit: number | null | undefined;
    __outliers_filter_mode: "ratio5x" | "minViews" | undefined;
    __outliers_min_views: number | null | undefined;
    __outliers_state: OutliersState | undefined;
  }
}
