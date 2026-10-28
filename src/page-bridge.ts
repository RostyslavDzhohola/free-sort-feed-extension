// Runs in the page's MAIN world, where Instagram's Relay store and TikTok's React props are
// visible. It answers the scanner's requests with the exact counts the page already holds,
// and never changes the page or makes a request of its own.
import {
  BRIDGE_VERSION,
  METRICS_REQUEST_EVENT,
  METRICS_RESPONSE_EVENT,
  type PageMetrics,
  type PageMetricsMap,
} from "./shared/bridge";

interface Fiber {
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  memoizedProps: unknown;
}

interface RelaySource {
  getRecordIDs: () => string[];
  get: (id: string) => Record<string, unknown> | null | undefined;
}

interface RelayStore {
  getSource: () => RelaySource;
}

function toCount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fiberOf(el: Element | null): Fiber | null {
  if (!el) return null;
  const key = Object.keys(el).find(function (k) {
    return k.startsWith("__reactFiber");
  });
  return key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null;
}

// ── Instagram ─────────────────────────────────────────────────────────────
let relayStore: RelayStore | null = null;

function findRelayStore(): RelayStore | null {
  const starts = [
    document.querySelector('main a[href*="/reel/"]'),
    document.querySelector("main header h2, main header h1"),
    document.querySelector("main"),
  ];
  for (let s = 0; s < starts.length; s++) {
    let fiber = fiberOf(starts[s] ?? null);
    for (let depth = 0; fiber && depth < 200; depth++) {
      const props = fiber.memoizedProps as Record<string, unknown> | null;
      if (props && typeof props === "object") {
        for (const key of Object.keys(props)) {
          const value = props[key] as { getStore?: () => RelayStore; environment?: { getStore?: () => RelayStore } } | null;
          if (!value || typeof value !== "object") continue;
          if (typeof value.getStore === "function") return value.getStore();
          if (value.environment && typeof value.environment.getStore === "function") return value.environment.getStore();
        }
      }
      fiber = fiber.return;
    }
  }
  return null;
}

function readInstagramMetrics(): PageMetricsMap {
  if (!relayStore) relayStore = findRelayStore();
  if (!relayStore) return {};
  const out: PageMetricsMap = {};
  const source = relayStore.getSource();
  const ids = source.getRecordIDs();
  for (let i = 0; i < ids.length; i++) {
    const record = source.get(ids[i]!);
    if (!record || record.__typename !== "XDTMediaDict" || typeof record.code !== "string") continue;
    const views = toCount(record.play_count) ?? toCount(record.ig_play_count) ?? toCount(record.view_count);
    const likes = toCount(record.like_count);
    const comments = toCount(record.comment_count);
    if (views === null && likes === null && comments === null) continue;
    const hidden = record.like_and_view_counts_disabled === true;
    out[record.code] = {
      views,
      // A creator who hides likes still gets like_count from the API, but the count isn't public.
      likes: hidden ? null : likes,
      comments,
      shares: null,
      saves: null,
      postedAt: toCount(record.taken_at),
      durationSec: toCount(record.video_duration),
      likesHidden: hidden,
    };
  }
  return out;
}

// ── TikTok ────────────────────────────────────────────────────────────────
interface TikTokItem {
  id?: string;
  stats?: Record<string, unknown>;
  statsV2?: Record<string, unknown>;
  createTime?: unknown;
  video?: { duration?: unknown };
}

function findTikTokItem(tile: Element): TikTokItem | null {
  const root = fiberOf(tile);
  if (!root) return null;
  // The tile's own React subtree carries the item it renders, a few levels down.
  const stack: Fiber[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < 400) {
    const fiber = stack.pop()!;
    visited++;
    const props = fiber.memoizedProps as { item?: TikTokItem } | null;
    if (props && typeof props === "object" && props.item && typeof props.item === "object" && props.item.stats) {
      return props.item;
    }
    if (fiber.sibling && fiber !== root) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  return null;
}

function readTikTokMetrics(): PageMetricsMap {
  const out: PageMetricsMap = {};
  const tiles = document.querySelectorAll('[data-e2e="user-post-item"]');
  for (let i = 0; i < tiles.length; i++) {
    const item = findTikTokItem(tiles[i]!);
    if (!item || !item.id) continue;
    const v2 = item.statsV2 ?? {};
    const v1 = item.stats ?? {};
    const pick = function (key: string): number | null {
      return toCount(v2[key]) ?? toCount(v1[key]);
    };
    const metrics: PageMetrics = {
      views: pick("playCount"),
      likes: pick("diggCount"),
      comments: pick("commentCount"),
      shares: pick("shareCount"),
      saves: pick("collectCount"),
      postedAt: toCount(item.createTime),
      durationSec: toCount(item.video?.duration) || null,
      likesHidden: false,
    };
    out[String(item.id)] = metrics;
  }
  return out;
}

function readMetrics(): PageMetricsMap {
  const host = window.location.hostname;
  try {
    if (/(^|\.)tiktok\.com$/i.test(host)) return readTikTokMetrics();
    if (/(^|\.)instagram\.com$/i.test(host)) return readInstagramMetrics();
  } catch (err) {
    // A store that moved under us is found again on the next request.
    relayStore = null;
    console.warn("[outliers] page bridge could not read metrics:", err);
  }
  return {};
}

if (window.__outliers_bridge !== BRIDGE_VERSION) {
  window.__outliers_bridge = BRIDGE_VERSION;
  document.addEventListener(METRICS_REQUEST_EVENT, function () {
    document.dispatchEvent(new CustomEvent(METRICS_RESPONSE_EVENT, { detail: JSON.stringify(readMetrics()) }));
  });
}
