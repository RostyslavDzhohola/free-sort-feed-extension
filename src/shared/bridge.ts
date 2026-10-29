// Protocol between the isolated-world scanner (injected.ts) and the MAIN-world page bridge
// (page-bridge.ts). The bridge can see the page's own data; the scanner can talk to the
// side panel. They meet on DOM events, which both worlds share. Event details cross the
// world boundary only as primitives, so the response is a JSON string.

// Bump with any bridge change: an open tab keeps the first bridge it was given, and a newer
// one registers beside it so the scanner hears the newest answer last.
export const BRIDGE_VERSION = "1.1.0.2";
export const METRICS_REQUEST_EVENT = "outliers:metrics-request";
export const METRICS_RESPONSE_EVENT = "outliers:metrics-response";

/** Exact numbers the page holds for one video. Null when the page doesn't have them. */
export interface PageMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  postedAt: number | null;
  durationSec: number | null;
  likesHidden: boolean;
  /** The cover the page loaded for the video, when it has one (TikTok). */
  thumbnailUrl?: string | null;
}

/** Keyed by Instagram shortcode or TikTok video id. */
export type PageMetricsMap = Record<string, PageMetrics>;

/** Ask the bridge for every video's numbers. Returns {} when the bridge isn't installed. */
export function requestPageMetrics(): PageMetricsMap {
  let result: PageMetricsMap = {};
  const onResponse = function (ev: Event): void {
    const detail = (ev as CustomEvent<unknown>).detail;
    if (typeof detail !== "string") return;
    try {
      const parsed = JSON.parse(detail) as unknown;
      if (parsed && typeof parsed === "object") result = parsed as PageMetricsMap;
    } catch {
      // Ignore malformed responses
    }
  };
  document.addEventListener(METRICS_RESPONSE_EVENT, onResponse);
  try {
    // Dispatch is synchronous, so the bridge has answered by the time this returns.
    document.dispatchEvent(new CustomEvent(METRICS_REQUEST_EVENT));
  } finally {
    document.removeEventListener(METRICS_RESPONSE_EVENT, onResponse);
  }
  return result;
}
