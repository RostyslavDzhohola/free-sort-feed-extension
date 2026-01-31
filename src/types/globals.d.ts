import type { OutliersState } from "./state";

export {};

declare global {
  interface Window {
    __outliers_active: boolean;
    __outliers_reset: (() => void) | undefined;
    __outliers_stop: (() => void) | undefined;
    __outliers_state: OutliersState | undefined;
  }
}
