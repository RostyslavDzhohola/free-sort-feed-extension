import { parseCount } from "./shared/parse-count";
import { readProfileInfo } from "./shared/read-profile";
import { buildEmptyStateCopy } from "./shared/empty-state-copy";
import { requestPageMetrics } from "./shared/bridge";
import { videoNoun } from "./shared/platform";
import {
  DEFAULT_VIEW,
  formatCount,
  formatExact,
  formatMetricPhrase,
  formatMultiple,
  getThreshold,
  isFilterMode,
  isSortKey,
  metricValue,
  resolveSortKey,
  selectVideos,
  sortLabel,
  viewsMultiple,
} from "./shared/videos";
import type { OutliersEntry, OutliersState, Platform, ViewSettings } from "./types/state";

/** What one grid tile shows. Counts are null when the tile doesn't show them. */
interface TileRead {
  id: string;
  url: string;
  href: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  thumbnailUrl: string | null;
}

interface CollectedVideo extends OutliersEntry {
  id: string;
}

interface PlatformAdapter {
  platform: Platform;
  isScanPage(): boolean;
  wrongPageMessage(): string;
  readTiles(): TileRead[];
  findGridHost(): HTMLElement | null;
  /** The platform's own link for a video, used to open its native viewer. */
  nativeAnchorFor(href: string): HTMLAnchorElement | null;
}

function init(): void {
  console.log("[outliers] init() called, __outliers_active:", window.__outliers_active);
  if (window.__outliers_active) {
    console.log("[outliers] Double-injection guard triggered — skipping init");
    return;
  }
  window.__outliers_active = true;

  let _runGeneration = 0;
  let _scrollTimer: number | null = null;
  let _gridHost: HTMLElement | null = null;
  let _gridHostDisplayBefore = "";
  const _hiddenBelowTabs: Array<{ el: HTMLElement; display: string }> = [];

  const runCtx = {
    videoMap: new Map<string, CollectedVideo>(),
    isStopRequested: false,
    isFinalizing: false,
    isDone: false,
    previousMapSize: 0,
    stableRounds: 0,
    scrollAttempts: 0,
  };

  const SCAN_LIMIT: number | null = window.__outliers_scan_limit ?? null;
  let view: ViewSettings = normalizeView(window.__outliers_view);
  let followers: number | null = positiveOrNull(window.__outliers_followers);

  const SCROLL_STEP_PX = 600;
  const SCROLL_WAIT_MS = 800;
  const MAX_SCROLL_ATTEMPTS = 500;

  const APP_ROOT_ID = "outliers-grid-root";
  const APP_STYLE_ID = "outliers-app-style";
  const LOCK_ID = "outliers-interaction-lock";

  const adapter: PlatformAdapter = /(^|\.)tiktok\.com$/i.test(window.location.hostname)
    ? createTikTokAdapter()
    : createInstagramAdapter();
  const NOUN = videoNoun(adapter.platform);
  const PROFILE_HANDLE = readProfileInfo()?.handle ?? null;

  let _interactionBlocker: ((ev: Event) => void) | null = null;

  function positiveOrNull(n: number | null | undefined): number | null {
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
  }

  function normalizeView(raw: ViewSettings | undefined): ViewSettings {
    const filterMode = isFilterMode(raw?.filterMode) ? raw!.filterMode : DEFAULT_VIEW.filterMode;
    const minViews = positiveOrNull(raw?.minViews) ?? DEFAULT_VIEW.minViews;
    const sortKey = isSortKey(raw?.sortKey) ? raw!.sortKey : DEFAULT_VIEW.sortKey;
    const sortDir = raw?.sortDir === "asc" ? "asc" : "desc";
    return { filterMode, minViews, sortKey, sortDir };
  }

  function getThresholdLabel(threshold: number | null): string {
    if (view.filterMode === "all") return "All " + NOUN;
    if (threshold === null) return "5× follower count";
    return formatExact(threshold) + " views";
  }

  function updateState(state: OutliersState): void {
    window.__outliers_state = state;
    try {
      chrome.runtime.sendMessage({ type: "outliers:state", state }).catch(function () {
        // Side panel may not be open — non-fatal
      });
    } catch {
      // Side panel may not be open — non-fatal
    }
  }

  function emitReset(): void {
    window.__outliers_state = undefined;
    try {
      chrome.runtime.sendMessage({ type: "outliers:reset" }).catch(function () {
        // Side panel may not be open — non-fatal
      });
    } catch {
      // Side panel may not be open — non-fatal
    }
  }

  // ── Tile readers ────────────────────────────────────────────────────────
  function pickFirstSrcsetUrl(srcset: string | null): string | null {
    if (!srcset) return null;
    const first = srcset.split(",")[0]?.trim() ?? "";
    if (!first) return null;
    const firstUrl = first.split(/\s+/)[0]?.trim() ?? "";
    return firstUrl || null;
  }

  // Lazy grids hold data: placeholders until a tile scrolls into view; only real image URLs count.
  function realUrl(url: string | null | undefined): string | null {
    const trimmed = (url ?? "").trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  }

  function readThumbnailUrl(root: Element): string | null {
    const img = root.querySelector("img") as HTMLImageElement | null;
    if (img) {
      const found = realUrl(img.currentSrc) ?? realUrl(img.getAttribute("src")) ?? realUrl(pickFirstSrcsetUrl(img.getAttribute("srcset")));
      if (found) return found;
    }
    // Instagram's Reels grid paints the cover as a background image.
    const painted = root.querySelectorAll('[style*="background-image"]');
    for (let i = 0; i < painted.length; i++) {
      const bg = (painted[i] as HTMLElement).style.backgroundImage;
      const m = bg.match(/url\((['"]?)(.*?)\1\)/i);
      const found = realUrl(m?.[2]);
      if (found) return found;
    }
    return null;
  }

  function nullIfNaN(n: number): number | null {
    return Number.isFinite(n) ? n : null;
  }

  function createInstagramAdapter(): PlatformAdapter {
    const REEL_HREF_RE = /\/reels?\/([^/?#]+)/i;
    const REEL_LINK_SELECTOR = 'a[href*="/reel/"], a[href*="/reels/"]';

    function isHeartSvg(svg: SVGSVGElement): boolean {
      const label = (svg.getAttribute("aria-label") ?? "").toLowerCase();
      if (/like|heart|unlik/.test(label)) return true;
      const parentLabel = svg.parentElement
        ? (svg.parentElement.getAttribute("aria-label") ?? "").toLowerCase()
        : "";
      if (/like|heart|unlik/.test(parentLabel)) return true;
      const paths = svg.querySelectorAll("path");
      for (let i = 0; i < paths.length; i++) {
        const d = paths[i]?.getAttribute("d") ?? "";
        const curveCount = (d.match(/[CcQqSs]/g) ?? []).length;
        if (curveCount >= 4) return true;
      }
      return false;
    }

    function isPlaySvg(svg: SVGSVGElement): boolean {
      const label = (svg.getAttribute("aria-label") ?? "").toLowerCase();
      if (/play|view|video|watch|reel/.test(label)) return true;
      const parentLabel = svg.parentElement
        ? (svg.parentElement.getAttribute("aria-label") ?? "").toLowerCase()
        : "";
      if (/play|view|video|watch|reel/.test(parentLabel)) return true;
      if (svg.querySelectorAll("polygon").length > 0) return true;
      const paths = svg.querySelectorAll("path");
      for (let i = 0; i < paths.length; i++) {
        const d = paths[i]?.getAttribute("d") ?? "";
        const curveCount = (d.match(/[CcQqSs]/g) ?? []).length;
        if (curveCount <= 1 && d.length < 80) return true;
      }
      return false;
    }

    function getNumberNearSvg(svg: SVGSVGElement): number {
      const container = svg.parentElement;
      if (!container) return NaN;
      let text = container.textContent?.trim() ?? "";
      let m = text.match(/([\d,.]+[KMBkmb]?)/);
      if (m) return parseCount(m[1]);
      const grandparent = container.parentElement;
      if (grandparent) {
        text = grandparent.textContent?.trim() ?? "";
        m = text.match(/([\d,.]+[KMBkmb]?)/);
        if (m) return parseCount(m[1]);
      }
      return NaN;
    }

    // The likes/comments overlay is a list inside the tile; its numbers are not views.
    function outsideOverlay(el: Element, link: Element): boolean {
      const list = el.closest("ul");
      return !list || !link.contains(list);
    }

    function readViews(link: HTMLAnchorElement): number {
      const ariaEls = link.querySelectorAll("[aria-label]");
      for (let a = 0; a < ariaEls.length; a++) {
        const label = ariaEls[a]?.getAttribute("aria-label") ?? "";
        const m = label.match(/([\d,.]+[KMBkmb]?)\s*(views|plays|play)/i);
        if (m) {
          const views = parseCount(m[1]);
          if (!isNaN(views)) return views;
        }
      }

      const linkAria = link.getAttribute("aria-label") ?? "";
      const lm = linkAria.match(/([\d,.]+[KMBkmb]?)\s*(views|plays|play)/i);
      if (lm && !isNaN(parseCount(lm[1]))) return parseCount(lm[1]);

      const svgs = Array.from(link.querySelectorAll("svg")).filter(function (svg) {
        return outsideOverlay(svg, link);
      });
      for (let s = 0; s < svgs.length; s++) {
        const svg = svgs[s]!;
        if (isPlaySvg(svg) && !isHeartSvg(svg)) {
          const num = getNumberNearSvg(svg);
          if (!isNaN(num) && num > 0) return num;
        }
      }
      for (let s = 0; s < svgs.length; s++) {
        const svg = svgs[s]!;
        const n = getNumberNearSvg(svg);
        if (!isNaN(n) && n > 0 && !isHeartSvg(svg)) return n;
      }

      const spans = link.querySelectorAll("span");
      let best = NaN;
      for (let sp = 0; sp < spans.length; sp++) {
        const span = spans[sp]!;
        if (!outsideOverlay(span, link)) continue;
        const txt = span.textContent?.trim() ?? "";
        if (!/^[\d,.]+[KMBkmb]?$/.test(txt)) continue;
        const parsed = parseCount(txt);
        if (!isNaN(parsed) && parsed > 0 && (isNaN(best) || parsed > best)) best = parsed;
      }
      return best;
    }

    // Likes and comments sit in the tile's hover overlay, in that order, before any hover.
    function readOverlayCounts(link: HTMLAnchorElement): { likes: number | null; comments: number | null } {
      const items = link.querySelectorAll("ul li");
      const likes = items[0] ? nullIfNaN(parseCount(items[0].textContent)) : null;
      const comments = items[1] ? nullIfNaN(parseCount(items[1].textContent)) : null;
      return { likes, comments };
    }

    return {
      platform: "instagram",
      isScanPage: function () {
        const url = window.location.href;
        if (/\/(explore|p|stories|direct)\//i.test(url)) return false;
        return /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/reels\/?(\?.*)?$/.test(url);
      },
      wrongPageMessage: function () {
        const onProfile = /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/?(\?.*)?$/.test(window.location.href);
        return onProfile
          ? 'Open the Reels tab of this profile first: click "Reels" (the film icon) on the profile, then try again.'
          : "Open an Instagram profile’s Reels tab first. Example: instagram.com/username/reels/";
      },
      readTiles: function () {
        const out: TileRead[] = [];
        const root = document.getElementById(APP_ROOT_ID);
        const links = document.querySelectorAll(REEL_LINK_SELECTOR);
        for (let i = 0; i < links.length; i++) {
          const link = links[i] as HTMLAnchorElement;
          if (root && root.contains(link)) continue;
          const href = link.getAttribute("href");
          const m = href ? href.match(REEL_HREF_RE) : null;
          if (!href || !m) continue;
          const overlay = readOverlayCounts(link);
          out.push({
            id: m[1]!,
            url: href.startsWith("http") ? href : "https://www.instagram.com" + href,
            href,
            views: nullIfNaN(readViews(link)),
            likes: overlay.likes,
            comments: overlay.comments,
            thumbnailUrl: readThumbnailUrl(link),
          });
        }
        return out;
      },
      findGridHost: function () {
        // Primary strategy: use the tabs line as boundary and take the content block below it.
        const tablist = document.querySelector('main [role="tablist"]') as HTMLElement | null;
        if (tablist) {
          let current: HTMLElement | null = tablist;
          while (current && current.tagName !== "MAIN") {
            const parentEl: HTMLElement | null = current.parentElement;
            if (!parentEl) break;
            let sibling = current.nextElementSibling as HTMLElement | null;
            while (sibling) {
              if (sibling.id !== APP_ROOT_ID && sibling.querySelector(REEL_LINK_SELECTOR)) return sibling;
              sibling = sibling.nextElementSibling as HTMLElement | null;
            }
            current = parentEl;
          }
        }

        // Fallback: derive host from existing reel links.
        const links = document.querySelectorAll(REEL_LINK_SELECTOR);
        if (links.length === 0) return null;
        let node: HTMLElement | null = (links[0] as HTMLAnchorElement).parentElement;
        let candidate: HTMLElement | null = null;
        while (node && node !== document.body) {
          if (node.tagName === "MAIN") break;
          const reelCount = node.querySelectorAll(REEL_LINK_SELECTOR).length;
          const hasTabList = !!node.querySelector('[role="tablist"]');
          const hasHeader = !!node.querySelector("header");
          if (reelCount >= 6 && !hasTabList && !hasHeader) candidate = node;
          node = node.parentElement;
        }
        return candidate;
      },
      nativeAnchorFor: function (href: string) {
        const root = document.getElementById(APP_ROOT_ID);
        const links = document.querySelectorAll(REEL_LINK_SELECTOR);
        for (let i = 0; i < links.length; i++) {
          const link = links[i] as HTMLAnchorElement;
          if (link.getAttribute("href") === href && !(root && root.contains(link))) return link;
        }
        return null;
      },
    };
  }

  function createTikTokAdapter(): PlatformAdapter {
    const VIDEO_HREF_RE = /\/(video|photo)\/(\d+)/;

    return {
      platform: "tiktok",
      isScanPage: function () {
        const parts = window.location.pathname.split("/").filter(Boolean);
        if (parts.length !== 1 || !parts[0]!.startsWith("@")) return false;
        const videosTab = document.querySelector('[data-e2e="videos-tab"]');
        return !videosTab || videosTab.getAttribute("aria-selected") === "true";
      },
      wrongPageMessage: function () {
        const parts = window.location.pathname.split("/").filter(Boolean);
        return parts.length === 1 && parts[0]!.startsWith("@")
          ? 'Open the Videos tab of this profile first, then try again.'
          : "Open a TikTok profile first. Example: tiktok.com/@username";
      },
      readTiles: function () {
        const out: TileRead[] = [];
        const tiles = document.querySelectorAll('[data-e2e="user-post-item"]');
        for (let i = 0; i < tiles.length; i++) {
          const tile = tiles[i]!;
          const link = tile.querySelector('a[href*="/video/"], a[href*="/photo/"]') as HTMLAnchorElement | null;
          if (!link) continue;
          const m = link.href.match(VIDEO_HREF_RE);
          if (!m) continue;
          let path = link.href;
          try {
            path = new URL(link.href).pathname;
          } catch {
            // Keep the full URL
          }
          const viewsEl = tile.querySelector('[data-e2e="video-views"]');
          out.push({
            id: m[2]!,
            url: link.href,
            href: path,
            views: viewsEl ? nullIfNaN(parseCount(viewsEl.textContent)) : null,
            likes: null,
            comments: null,
            thumbnailUrl: readThumbnailUrl(tile),
          });
        }
        return out;
      },
      findGridHost: function () {
        return document.querySelector('[data-e2e="user-post-item-list"]') as HTMLElement | null;
      },
      nativeAnchorFor: function () {
        // TikTok's player takes over the page; a new tab keeps the sorted grid in place.
        return null;
      },
    };
  }

  // ── Collection ──────────────────────────────────────────────────────────
  function collectVisibleVideos(): void {
    const tiles = adapter.readTiles();
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]!;
      const existing = runCtx.videoMap.get(tile.id);
      if (!existing) {
        // Cap at the limit, so "first 100" means exactly the first 100 in grid order.
        if (SCAN_LIMIT !== null && runCtx.videoMap.size >= SCAN_LIMIT) continue;
        runCtx.videoMap.set(tile.id, {
          id: tile.id,
          url: tile.url,
          href: tile.href,
          views: tile.views,
          ratio: 0,
          thumbnailUrl: tile.thumbnailUrl,
          platform: adapter.platform,
          likes: tile.likes,
          comments: tile.comments,
          shares: null,
          saves: null,
          postedAt: null,
          durationSec: null,
          likesHidden: false,
        });
        continue;
      }
      if (existing.views == null && tile.views != null) existing.views = tile.views;
      if (existing.likes == null && tile.likes != null && !existing.likesHidden) existing.likes = tile.likes;
      if (existing.comments == null && tile.comments != null) existing.comments = tile.comments;
      if (!existing.thumbnailUrl && tile.thumbnailUrl) existing.thumbnailUrl = tile.thumbnailUrl;
    }

    // Exact counts from the page's own data replace the rounded numbers tiles show.
    const exact = requestPageMetrics();
    runCtx.videoMap.forEach(function (video) {
      const m = exact[video.id];
      if (!m) return;
      if (m.views != null) video.views = m.views;
      if (m.likesHidden) {
        video.likes = null;
        video.likesHidden = true;
      } else if (m.likes != null) {
        video.likes = m.likes;
      }
      if (m.comments != null) video.comments = m.comments;
      if (m.shares != null) video.shares = m.shares;
      if (m.saves != null) video.saves = m.saves;
      if (m.postedAt != null) video.postedAt = m.postedAt;
      if (m.durationSec != null) video.durationSec = m.durationSec;
      if (m.thumbnailUrl) video.thumbnailUrl = m.thumbnailUrl;
    });
  }

  function currentFollowers(): number | null {
    if (followers === null) followers = positiveOrNull(readProfileInfo()?.followers);
    return followers;
  }

  function toEntries(): OutliersEntry[] {
    const f = currentFollowers();
    const out: OutliersEntry[] = [];
    runCtx.videoMap.forEach(function (video) {
      const entry: OutliersEntry = {
        url: video.url,
        href: video.href,
        views: video.views,
        ratio: f && video.views != null ? video.views / f : 0,
        thumbnailUrl: video.thumbnailUrl,
        platform: video.platform,
        likes: video.likes,
        comments: video.comments,
        shares: video.shares,
        saves: video.saves,
        postedAt: video.postedAt,
        durationSec: video.durationSec,
        likesHidden: video.likesHidden,
      };
      out.push(entry);
    });
    return out;
  }

  function buildState(status: OutliersState["status"], phase: OutliersState["phase"]): OutliersState {
    const videos = toEntries();
    const f = currentFollowers();
    const threshold = getThreshold(view.filterMode, f, view.minViews);
    const sortKey = resolveSortKey(view.sortKey, adapter.platform);
    const effectiveView: ViewSettings = { ...view, sortKey };
    return {
      status,
      phase,
      platform: adapter.platform,
      profileHandle: PROFILE_HANDLE,
      followers: f,
      threshold,
      filterMode: view.filterMode,
      minViews: view.filterMode === "minViews" ? view.minViews : null,
      sortKey,
      sortDir: view.sortDir,
      activeThresholdLabel: getThresholdLabel(threshold),
      scannedCount: videos.length,
      scanLimit: SCAN_LIMIT,
      outliers: selectVideos(videos, effectiveView, f),
      errorText: null,
    };
  }

  // ── Page chrome ─────────────────────────────────────────────────────────
  function ensureAppStyle(): void {
    if (document.getElementById(APP_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = APP_STYLE_ID;
    const R = "#" + APP_ROOT_ID;
    const FONT = "'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', 'Chalkboard', 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif";
    style.textContent = [
      R + " { width: 100%; box-sizing: border-box; padding: 20px 16px 40px; display: block; color: inherit; }",
      R + ", " + R + " * { font-family: " + FONT + " !important; box-sizing: border-box; }",
      R + " .outliers-app-shell { width: min(1100px, 100%); margin: 0 auto; }",
      R + " .outliers-app-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }",
      R + " .outliers-app-title { font-size: 18px; font-weight: 700; }",
      R + " .outliers-app-meta { font-size: 13px; opacity: 0.72; text-align: right; }",
      R + " .outliers-app-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }",
      "@media (min-width: 760px) { " + R + " .outliers-app-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }",
      "@media (min-width: 1080px) { " + R + " .outliers-app-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }",
      R + " .outliers-card { position: relative; display: block; aspect-ratio: 2 / 3; border-radius: 14px; overflow: hidden; background: #2b1943; color: #fff; text-decoration: none; isolation: isolate; transition: transform 140ms ease, box-shadow 140ms ease; }",
      R + " .outliers-card:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(43, 25, 67, 0.35); }",
      R + " .outliers-card:focus-visible { outline: 3px solid #950acc; outline-offset: 2px; }",
      R + " .outliers-card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; }",
      R + " .outliers-card-shade { position: absolute; inset: 0; z-index: -1; background: linear-gradient(to bottom, rgba(0,0,0,0.42) 0, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.82) 100%); }",
      R + " .outliers-card-rank { position: absolute; top: 8px; left: 8px; padding: 3px 9px; border-radius: 999px; background: #950acc; font-size: 13px; font-weight: 800; }",
      R + " .outliers-card-multiple { position: absolute; top: 8px; right: 8px; padding: 3px 9px; border-radius: 999px; background: #f99b21; color: #2b1943; font-size: 13px; font-weight: 800; }",
      R + " .outliers-card-info { position: absolute; left: 10px; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 5px; }",
      R + " .outliers-card-primary { font-size: 18px; font-weight: 800; line-height: 1.15; text-shadow: 0 1px 3px rgba(0,0,0,0.5); }",
      R + " .outliers-card-stats { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12.5px; font-weight: 700; line-height: 1.2; }",
      R + " .outliers-card-stat { display: inline-flex; align-items: center; gap: 3px; opacity: 0.92; }",
      R + " .outliers-card-stat.active { color: #ffd08a; opacity: 1; }",
      R + " .outliers-card-stat svg { width: 13px; height: 13px; flex: 0 0 auto; }",
      R + " .outliers-empty { max-width: 720px; margin: 24px auto 0; padding: 22px 24px; border: 1px solid rgba(127,127,127,0.25); border-radius: 18px; text-align: center; }",
      R + " .outliers-empty-title { font-size: 22px; font-weight: 700; line-height: 1.25; }",
      R + " .outliers-empty-detail { margin-top: 10px; font-size: 17px; line-height: 1.5; opacity: 0.75; }",
      "#" + LOCK_ID + " { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; background: rgba(34, 197, 94, 0.18) !important; backdrop-filter: saturate(120%); pointer-events: auto !important; cursor: progress; }",
    ].join("\n");
    document.head.appendChild(style);
  }

  function removeAppStyle(): void {
    const style = document.getElementById(APP_STYLE_ID);
    if (style) style.remove();
  }

  function hideGridHost(): void {
    if (_gridHost && _gridHost.isConnected) {
      _gridHost.style.setProperty("display", "none", "important");
      _gridHost.setAttribute("aria-hidden", "true");
      return;
    }

    const host = adapter.findGridHost();
    if (!host) {
      if (_hiddenBelowTabs.length > 0) return;
      const tablist = document.querySelector('main [role="tablist"]') as HTMLElement | null;
      if (!tablist?.parentElement) return;
      let sibling = tablist.nextElementSibling as HTMLElement | null;
      while (sibling) {
        if (sibling.id !== APP_ROOT_ID) {
          _hiddenBelowTabs.push({ el: sibling, display: sibling.style.display });
          sibling.style.setProperty("display", "none", "important");
          sibling.setAttribute("aria-hidden", "true");
        }
        sibling = sibling.nextElementSibling as HTMLElement | null;
      }
      return;
    }

    _gridHost = host;
    _gridHostDisplayBefore = _gridHost.style.display;
    _gridHost.style.setProperty("display", "none", "important");
    _gridHost.setAttribute("aria-hidden", "true");
  }

  function showGridHost(): void {
    while (_hiddenBelowTabs.length > 0) {
      const row = _hiddenBelowTabs.pop()!;
      row.el.style.display = row.display;
      row.el.removeAttribute("aria-hidden");
    }
    if (!_gridHost) return;
    _gridHost.style.display = _gridHostDisplayBefore;
    _gridHost.removeAttribute("aria-hidden");
    _gridHost = null;
    _gridHostDisplayBefore = "";
  }

  function getOrCreateAppRoot(): HTMLElement {
    const existing = document.getElementById(APP_ROOT_ID) as HTMLElement | null;
    if (existing) return existing;

    const root = document.createElement("section");
    root.id = APP_ROOT_ID;

    const host = _gridHost ?? adapter.findGridHost();
    if (host?.parentElement) {
      host.parentElement.insertBefore(root, host.nextSibling);
    } else {
      const tablist = document.querySelector('main [role="tablist"]') as HTMLElement | null;
      if (tablist?.parentElement) {
        tablist.parentElement.insertBefore(root, tablist.nextSibling);
      } else {
        const main = document.querySelector('main[role="main"], main') as HTMLElement | null;
        (main ?? document.body).appendChild(root);
      }
    }
    return root;
  }

  function removeAppRoot(): void {
    const root = document.getElementById(APP_ROOT_ID);
    if (root) root.remove();
  }

  function showInteractionLock(): void {
    if (document.getElementById(LOCK_ID)) return;
    const lock = document.createElement("div");
    lock.id = LOCK_ID;

    const block = function (ev: Event): void {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    };
    _interactionBlocker = block;

    lock.addEventListener("click", block, true);
    lock.addEventListener("mousedown", block, true);
    lock.addEventListener("wheel", block, { capture: true, passive: false });
    lock.addEventListener("touchmove", block, { capture: true, passive: false });
    document.addEventListener("keydown", block, { capture: true });

    document.body.appendChild(lock);
  }

  function hideInteractionLock(): void {
    const lock = document.getElementById(LOCK_ID);
    if (lock) lock.remove();
    if (_interactionBlocker) {
      document.removeEventListener("keydown", _interactionBlocker, { capture: true });
      _interactionBlocker = null;
    }
  }

  // ── In-page grid ────────────────────────────────────────────────────────
  const ICONS: Record<string, string> = {
    views: "M8 5.5v13l10.5-6.5z",
    likes: "M12 20.5s-7.6-4.6-9.5-9.3C1.2 7.9 3.3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3 1.7-1.8 3.2-3 5.3-3 3.4 0 5.5 3.4 4.2 6.7-1.9 4.7-9.5 9.3-9.5 9.3z",
    comments: "M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.5L5 21v-3.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z",
    shares: "M13.5 5v4C6.5 9.6 4 14 3.5 19.5c2-3.2 4.8-4.6 10-4.6V19L21 12z",
    saves: "M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z",
  };

  function statEl(key: string, value: number | null | undefined, active: boolean): HTMLElement {
    const span = document.createElement("span");
    span.className = "outliers-card-stat" + (active ? " active" : "");
    span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + ICONS[key] + '"/></svg>';
    span.appendChild(document.createTextNode(value == null ? "—" : formatCount(value)));
    span.setAttribute("aria-label", (value == null ? "unknown" : formatExact(value)) + " " + key);
    return span;
  }

  function didNativeModalOpen(dialogsBefore: number, pathBefore: string): boolean {
    if (document.querySelectorAll('div[role="dialog"]').length > dialogsBefore) return true;
    const pathAfter = window.location.pathname;
    return pathAfter !== pathBefore && /\/(reel|reels|p|video|photo)\//i.test(pathAfter);
  }

  function buildCard(entry: OutliersEntry, rank: number, f: number | null, sortKey: ViewSettings["sortKey"]): HTMLElement {
    const card = document.createElement("a");
    card.className = "outliers-card";
    card.href = entry.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    if (entry.thumbnailUrl) {
      const img = document.createElement("img");
      img.src = entry.thumbnailUrl;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      card.appendChild(img);
    }

    const shade = document.createElement("div");
    shade.className = "outliers-card-shade";
    card.appendChild(shade);

    const rankEl = document.createElement("span");
    rankEl.className = "outliers-card-rank";
    rankEl.textContent = "#" + rank;
    card.appendChild(rankEl);

    // The badge marks videos that out-reached the follower count; smaller multiples stay in the panel.
    const multiple = viewsMultiple(entry, f);
    if (multiple !== null && multiple >= 1) {
      const multEl = document.createElement("span");
      multEl.className = "outliers-card-multiple";
      multEl.textContent = formatMultiple(multiple);
      multEl.title = "Views ÷ followers";
      card.appendChild(multEl);
    }

    const info = document.createElement("div");
    info.className = "outliers-card-info";
    const primary = document.createElement("div");
    primary.className = "outliers-card-primary";
    primary.textContent = formatMetricPhrase(sortKey, metricValue(entry, sortKey, f));
    info.appendChild(primary);

    const stats = document.createElement("div");
    stats.className = "outliers-card-stats";
    stats.appendChild(statEl("views", entry.views, sortKey === "views"));
    stats.appendChild(statEl("likes", entry.likes, sortKey === "likes"));
    stats.appendChild(statEl("comments", entry.comments, sortKey === "comments"));
    if (adapter.platform === "tiktok") {
      stats.appendChild(statEl("shares", entry.shares, sortKey === "shares"));
      stats.appendChild(statEl("saves", entry.saves, sortKey === "saves"));
    }
    info.appendChild(stats);
    card.appendChild(info);

    card.setAttribute("aria-label", "#" + rank + ", " + primary.textContent);

    card.addEventListener("click", function (ev) {
      const mouse = ev as MouseEvent;
      // Modified clicks keep the browser's own new-tab behavior.
      if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
      const native = adapter.nativeAnchorFor(entry.href);
      if (!native) return;
      // Prefer the platform's own viewer; it keeps this grid in place underneath.
      ev.preventDefault();
      const dialogsBefore = document.querySelectorAll('div[role="dialog"]').length;
      const pathBefore = window.location.pathname;
      native.click();
      window.setTimeout(function () {
        if (didNativeModalOpen(dialogsBefore, pathBefore)) return;
        window.open(entry.url, "_blank", "noopener,noreferrer");
      }, 500);
    });

    return card;
  }

  function renderCustomGrid(state: OutliersState): void {
    ensureAppStyle();
    hideGridHost();

    const root = getOrCreateAppRoot();
    root.replaceChildren();

    const shell = document.createElement("div");
    shell.className = "outliers-app-shell";

    const header = document.createElement("div");
    header.className = "outliers-app-header";

    const title = document.createElement("div");
    title.className = "outliers-app-title";
    title.textContent = "Outliers" + (state.profileHandle ? " · @" + state.profileHandle : "");

    const sortKey = state.sortKey ?? "views";
    const meta = document.createElement("div");
    meta.className = "outliers-app-meta";
    meta.textContent = state.outliers.length + " of " + state.scannedCount + " " + NOUN
      + " • " + state.activeThresholdLabel
      + " • sorted by " + sortLabel(sortKey).toLowerCase() + (state.sortDir === "asc" ? " ↑" : " ↓");

    header.appendChild(title);
    header.appendChild(meta);
    shell.appendChild(header);

    if (state.outliers.length === 0) {
      const copy = buildEmptyStateCopy({
        platform: adapter.platform,
        filterMode: state.filterMode,
        followers: state.followers,
        threshold: state.threshold,
        minViews: state.minViews,
        scanLimit: state.scanLimit,
        scannedCount: state.scannedCount,
      });
      const empty = document.createElement("div");
      empty.className = "outliers-empty";
      const emptyTitle = document.createElement("div");
      emptyTitle.className = "outliers-empty-title";
      emptyTitle.textContent = copy.title;
      const emptyDetail = document.createElement("div");
      emptyDetail.className = "outliers-empty-detail";
      emptyDetail.textContent = copy.detail;
      empty.appendChild(emptyTitle);
      empty.appendChild(emptyDetail);
      shell.appendChild(empty);
      root.appendChild(shell);
      return;
    }

    const grid = document.createElement("div");
    grid.className = "outliers-app-grid";
    for (let i = 0; i < state.outliers.length; i++) {
      grid.appendChild(buildCard(state.outliers[i]!, i + 1, state.followers, sortKey));
    }
    shell.appendChild(grid);
    root.appendChild(shell);
  }

  // ── Run lifecycle ───────────────────────────────────────────────────────
  function reportError(errorText: string): void {
    cancelPendingScroll();
    hideInteractionLock();
    removeAppRoot();
    removeAppStyle();
    showGridHost();
    window.__outliers_active = false;

    const threshold = getThreshold(view.filterMode, followers, view.minViews);
    updateState({
      status: "error",
      phase: "rendered",
      platform: adapter.platform,
      profileHandle: null,
      followers: null,
      threshold: null,
      filterMode: view.filterMode,
      minViews: view.filterMode === "minViews" ? view.minViews : null,
      sortKey: view.sortKey,
      sortDir: view.sortDir,
      activeThresholdLabel: getThresholdLabel(threshold),
      scannedCount: runCtx.videoMap.size,
      scanLimit: SCAN_LIMIT,
      outliers: [],
      errorText,
    });
  }

  function resetRunContext(): void {
    runCtx.videoMap.clear();
    runCtx.isStopRequested = false;
    runCtx.isFinalizing = false;
    runCtx.isDone = false;
    runCtx.previousMapSize = 0;
    runCtx.stableRounds = 0;
    runCtx.scrollAttempts = 0;
  }

  function cancelPendingScroll(): void {
    if (_scrollTimer !== null) {
      window.clearTimeout(_scrollTimer);
      _scrollTimer = null;
    }
  }

  function analyze(myGen: number): void {
    if (myGen !== _runGeneration) return;
    console.log("[outliers] analyze() — videos collected:", runCtx.videoMap.size);

    if (runCtx.videoMap.size === 0) {
      reportError(
        adapter.platform === "tiktok"
          ? "Couldn’t find any videos on this profile. It may be private or have no posts yet."
          : "Couldn’t find any Reels on this page. Make sure the Reels tab shows videos, then try again."
      );
      return;
    }

    const state = buildState("done", "rendered");
    renderCustomGrid(state);
    hideInteractionLock();
    runCtx.isDone = true;
    updateState(state);
  }

  function finalizeFromCurrentMap(myGen: number): void {
    if (myGen !== _runGeneration) return;
    if (runCtx.isFinalizing) return;

    runCtx.isFinalizing = true;
    cancelPendingScroll();
    collectVisibleVideos();
    // Emit one last progressive snapshot before final render so the side panel stays live.
    updateState(buildState("scanning", "analyzing"));

    window.scrollTo(0, 0);
    _scrollTimer = window.setTimeout(function () {
      _scrollTimer = null;
      if (myGen !== _runGeneration) return;
      analyze(myGen);
    }, 80);
  }

  function autoScrollAndRun(): void {
    _runGeneration++;
    const myGen = _runGeneration;

    resetRunContext();
    removeAppRoot();
    showGridHost();
    ensureAppStyle();
    showInteractionLock();

    updateState(buildState("scanning", "scanning"));

    function scrollStep(): void {
      try {
        if (myGen !== _runGeneration) return;
        if (runCtx.isStopRequested) {
          finalizeFromCurrentMap(myGen);
          return;
        }

        collectVisibleVideos();
        const currentSize = runCtx.videoMap.size;

        if (currentSize > runCtx.previousMapSize) {
          runCtx.stableRounds = 0;
          runCtx.previousMapSize = currentSize;
          // Stream partial results while scanning so users can see progress in real time.
          updateState(buildState("scanning", "scanning"));
        } else {
          runCtx.stableRounds++;
        }

        runCtx.scrollAttempts++;

        const reachedLimit = SCAN_LIMIT !== null && currentSize >= SCAN_LIMIT;
        const reachedNaturalEnd = runCtx.stableRounds >= 8 || runCtx.scrollAttempts >= MAX_SCROLL_ATTEMPTS;

        if (reachedLimit || reachedNaturalEnd) {
          finalizeFromCurrentMap(myGen);
          return;
        }

        window.scrollTo(0, window.scrollY + SCROLL_STEP_PX);
        _scrollTimer = window.setTimeout(scrollStep, SCROLL_WAIT_MS);
      } catch (err) {
        console.error("[outliers] Scroll loop error:", err);
        reportError("Scroll loop error — please try again.");
      }
    }

    scrollStep();
  }

  function resetAll(): void {
    _runGeneration++;
    cancelPendingScroll();
    resetRunContext();
    hideInteractionLock();
    removeAppRoot();
    removeAppStyle();
    _hiddenBelowTabs.length = 0;
    _gridHost = null;
    _gridHostDisplayBefore = "";

    window.__outliers_active = false;
    emitReset();
    window.location.reload();
  }

  window.__outliers_reset = resetAll;

  function stopScan(): void {
    if (!window.__outliers_active) return;
    runCtx.isStopRequested = true;
    cancelPendingScroll();
    finalizeFromCurrentMap(_runGeneration);
  }

  window.__outliers_stop = stopScan;

  // The side panel changes the filter or sort without a rescan; redraw from what was collected.
  function applyView(next: ViewSettings): void {
    view = normalizeView(next);
    if (runCtx.videoMap.size === 0) return;
    const scanning = !runCtx.isDone;
    const state = buildState(scanning ? "scanning" : "done", scanning ? (runCtx.isFinalizing ? "analyzing" : "scanning") : "rendered");
    if (!scanning) renderCustomGrid(state);
    updateState(state);
  }

  window.__outliers_apply_view = applyView;

  function run(): void {
    const onScanPage = adapter.isScanPage();
    console.log("[outliers] run() — URL:", window.location.href, "scan page:", onScanPage);

    if (!onScanPage) {
      reportError(adapter.wrongPageMessage());
      return;
    }

    autoScrollAndRun();
  }

  run();
}

init();
