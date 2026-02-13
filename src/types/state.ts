/** Serializable outlier data sent from injected script to side panel. */
export interface OutliersEntry {
  url: string;
  href: string;
  views: number;
  ratio: number;
}

export type FilterMode = "ratio5x" | "minViews";
export type MinViewsPreset = 10000 | 100000 | 1000000 | null;

export interface SavedReel extends OutliersEntry {
  savedAt: string;
  profilePath: string | null;
}

/** Persisted tab state stored on window.__outliers_state (JSON-serializable). */
export interface OutliersState {
  status: "idle" | "scanning" | "done" | "error";
  followers: number | null;
  threshold: number | null;
  filterMode: FilterMode;
  minViews: number | null;
  activeThresholdLabel: string;
  scannedCount: number;
  scanLimit: number | null;
  outliers: OutliersEntry[];
  errorText: string | null;
}

/** Messages sent from injected script → side panel via chrome.runtime.sendMessage. */
export type OutliersMessage =
  | { type: "outliers:state"; state: OutliersState }
  | { type: "outliers:reset" };
