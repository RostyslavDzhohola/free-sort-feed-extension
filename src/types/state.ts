/** Serializable outlier data sent from injected script to side panel. */
export interface OutliersEntry {
  url: string;
  href: string;
  views: number;
  ratio: number;
}

/** Persisted tab state stored on window.__outliers_state (JSON-serializable). */
export interface OutliersState {
  status: "idle" | "scanning" | "done" | "error";
  followers: number | null;
  threshold: number | null;
  scannedCount: number;
  scanLimit: number | null;
  outliers: OutliersEntry[];
  errorText: string | null;
}

/** Messages sent from injected script → side panel via chrome.runtime.sendMessage. */
export type OutliersMessage =
  | { type: "outliers:state"; state: OutliersState }
  | { type: "outliers:reset" };
