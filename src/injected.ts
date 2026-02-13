import { parseCount } from "./shared/parse-count";
import type { ReelData } from "./types/reel";
import type { OutliersState, OutliersEntry, FilterMode } from "./types/state";

// esbuild wraps this file in an IIFE, so all top-level code is scoped.
// We use an init() function with a double-injection guard.

function init(): void {
  console.log("[outliers] init() called, __outliers_active:", window.__outliers_active);
  if (window.__outliers_active) {
    console.log("[outliers] Double-injection guard triggered — skipping init");
    return;
  }
  window.__outliers_active = true;

  let _runGeneration = 0;

  // Read config set by side panel before injection.
  const SCAN_LIMIT: number | null = window.__outliers_scan_limit ?? null;
  const FILTER_MODE: FilterMode = window.__outliers_filter_mode === "minViews" ? "minViews" : "ratio5x";
  const MIN_VIEWS: number = window.__outliers_min_views && window.__outliers_min_views > 0
    ? window.__outliers_min_views
    : 10000;
  console.log("[outliers] SCAN_LIMIT:", SCAN_LIMIT);
  console.log("[outliers] FILTER_MODE:", FILTER_MODE, "MIN_VIEWS:", MIN_VIEWS);

  // ── Constants ──────────────────────────────────────────────────────────
  const MULTIPLIER = 5;
  const HIDDEN_CLASS = "outliers-hidden";
  const VISIBLE_CELL_CLASS = "outliers-visible-cell";
  const HIDDEN_ROW_CLASS = "outliers-hidden-row";
  const SCROLL_STEP_PX = 600;
  const SCROLL_WAIT_MS = 800;
  const MAX_SCROLL_ATTEMPTS = 500; // safety cap
  const REEL_HREF_RE = /\/reel(s)?\/[^/?#]+/i;
  const REEL_LINK_SELECTOR = 'a[href*="/reel/"], a[href*="/reels/"]';

  // ── State ──────────────────────────────────────────────────────────────
  let _hideObserver: MutationObserver | null = null;
  let _qualifyingHrefs: Set<string> | null = null;
  let _scrollLockActive = false;
  let _docOverflowBeforeLock = "";
  let _bodyOverflowBeforeLock = "";

  function getActiveThresholdLabel(threshold: number): string {
    if (FILTER_MODE === "minViews") return threshold.toLocaleString("en-US") + " views";
    return threshold.toLocaleString("en-US") + " views";
  }

  // ── State management + messaging ──────────────────────────────────────
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

  // ── Page detection ─────────────────────────────────────────────────────
  function isReelsPage(): boolean {
    const url = window.location.href;
    if (/\/(explore|p|stories|direct)\//i.test(url)) return false;
    return /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/reels\/?(\?.*)?$/.test(
      url
    );
  }

  // ── SVG classification ─────────────────────────────────────────────────
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

    const polys = svg.querySelectorAll("polygon");
    if (polys.length > 0) return true;
    const paths = svg.querySelectorAll("path");
    for (let i = 0; i < paths.length; i++) {
      const d = paths[i]?.getAttribute("d") ?? "";
      const curveCount = (d.match(/[CcQqSs]/g) ?? []).length;
      if (curveCount <= 1 && d.length < 80) return true;
    }
    return false;
  }

  // ── Extract number near an SVG element ─────────────────────────────────
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

  function isReelPermalinkHref(href: string | null): href is string {
    if (!href) return false;
    return REEL_HREF_RE.test(href);
  }

  // ── Follower extraction ────────────────────────────────────────────────
  function getFollowerCount(): number {
    const followerLinks = document.querySelectorAll('a[href*="/followers"]');
    for (let i = 0; i < followerLinks.length; i++) {
      const link = followerLinks[i]!;

      const title = link.getAttribute("title");
      if (title) {
        const c = parseCount(title.replace(/,/g, ""));
        if (!isNaN(c) && c > 0) return c;
      }

      const innerSpans = link.querySelectorAll("span");
      for (let s = innerSpans.length - 1; s >= 0; s--) {
        const spanText = innerSpans[s]?.textContent?.trim() ?? "";
        if (/^[\d,.]+[KMBkmb]?$/.test(spanText)) {
          const parsed = parseCount(spanText);
          if (!isNaN(parsed) && parsed > 0) return parsed;
        }
      }

      const text = link.textContent?.trim() ?? "";
      const m2 = text.match(/([\d,.]+[KMBkmb]?)/);
      if (m2) {
        const c2 = parseCount(m2[1]);
        if (!isNaN(c2) && c2 > 0) return c2;
      }
    }

    const headerSection = document.querySelector("header section");
    if (headerSection) {
      const hSpans = headerSection.querySelectorAll("span");
      for (let j = 0; j < hSpans.length; j++) {
        const parent = hSpans[j]?.parentElement;
        if (parent && /followers/i.test(parent.textContent ?? "")) {
          const hText = hSpans[j]?.textContent?.trim() ?? "";
          if (/^[\d,.]+[KMBkmb]?$/.test(hText)) {
            const c3 = parseCount(hText);
            if (!isNaN(c3) && c3 > 0) return c3;
          }
        }
      }
    }

    const meta = document.querySelector('meta[property="og:description"]');
    if (meta) {
      const content = meta.getAttribute("content") ?? "";
      const m = content.match(/([\d,.]+[KMBkmb]?)\s+Followers/i);
      if (m) {
        const count = parseCount(m[1]);
        if (!isNaN(count) && count > 0) return count;
      }
    }

    return NaN;
  }

  // ── Layout filtering + ordering ────────────────────────────────────────
  function injectHideStyle(): void {
    if (document.getElementById("outliers-style")) return;
    const style = document.createElement("style");
    style.id = "outliers-style";
    style.textContent = [
      "." + HIDDEN_CLASS + " {",
      "  display: none !important;",
      "}",
      "." + VISIBLE_CELL_CLASS + " {",
      "  flex: 0 0 33.3333% !important;",
      "  max-width: 33.3333% !important;",
      "}",
      "." + HIDDEN_ROW_CLASS + " {",
      "  display: none !important;",
      "}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function removeHideStyle(): void {
    const style = document.getElementById("outliers-style");
    if (style) style.remove();
  }

  function clearTileClasses(): void {
    const nodes = document.querySelectorAll("." + HIDDEN_CLASS + ", ." + VISIBLE_CELL_CLASS);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as HTMLElement;
      node.classList.remove(HIDDEN_CLASS);
      node.classList.remove(VISIBLE_CELL_CLASS);
      node.style.removeProperty("order");
      node.style.removeProperty("flex");
      node.style.removeProperty("width");
      node.style.removeProperty("max-width");
    }

    const rows = document.querySelectorAll("." + HIDDEN_ROW_CLASS);
    for (let i = 0; i < rows.length; i++) {
      rows[i]!.classList.remove(HIDDEN_ROW_CLASS);
    }
  }

  function lockPageScroll(): void {
    if (_scrollLockActive) return;
    _docOverflowBeforeLock = document.documentElement.style.overflow;
    _bodyOverflowBeforeLock = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    _scrollLockActive = true;
  }

  function unlockPageScroll(): void {
    if (!_scrollLockActive) return;
    document.documentElement.style.overflow = _docOverflowBeforeLock;
    document.body.style.overflow = _bodyOverflowBeforeLock;
    _docOverflowBeforeLock = "";
    _bodyOverflowBeforeLock = "";
    _scrollLockActive = false;
  }

  function collectUniqueReelHrefs(root: Element): Set<string> {
    const hrefs = new Set<string>();
    if (root instanceof HTMLAnchorElement) {
      const href = root.getAttribute("href");
      if (isReelPermalinkHref(href)) hrefs.add(href);
      return hrefs;
    }

    const anchors = root.querySelectorAll(REEL_LINK_SELECTOR);
    for (let i = 0; i < anchors.length; i++) {
      const href = anchors[i]!.getAttribute("href");
      if (isReelPermalinkHref(href)) hrefs.add(href);
    }
    return hrefs;
  }

  function resolveTileRoot(
    link: HTMLAnchorElement,
    getHrefsForNode: (node: Element) => Set<string>
  ): HTMLElement | null {
    let current: HTMLElement | null = link;
    while (current && current !== document.body) {
      const parentEl: HTMLElement | null = current.parentElement;
      if (!parentEl) break;

      const currentHrefs = getHrefsForNode(current);
      let siblingTileCount = 0;
      for (let i = 0; i < parentEl.children.length; i++) {
        const sibling = parentEl.children[i]!;
        const siblingHrefs = getHrefsForNode(sibling);
        if (siblingHrefs.size === 1) {
          siblingTileCount++;
        }
      }

      const display = window.getComputedStyle(current).display;
      const rect = current.getBoundingClientRect();
      const maxTileWidth = window.innerWidth * 0.45;
      const maxTileHeight = window.innerHeight * 0.9;
      const looksLikeTileSize =
        rect.width >= 80 &&
        rect.height >= 80 &&
        rect.width <= maxTileWidth &&
        rect.height <= maxTileHeight;

      // Return the first (closest) valid candidate so we stay at grid-cell level.
      if (
        currentHrefs.size === 1 &&
        siblingTileCount >= 3 &&
        display !== "contents" &&
        looksLikeTileSize
      ) {
        return current;
      }

      current = parentEl;
    }

    return (
      (link.closest("article, li") as HTMLElement | null) ??
      link.parentElement
    );
  }

  function collectTileRootsByHref(): Map<string, HTMLElement> {
    const tilesByHref = new Map<string, HTMLElement>();
    const hrefCache = new WeakMap<Element, Set<string>>();
    const getHrefsForNode = function (node: Element): Set<string> {
      const cached = hrefCache.get(node);
      if (cached) return cached;
      const computed = collectUniqueReelHrefs(node);
      hrefCache.set(node, computed);
      return computed;
    };
    const links = document.querySelectorAll(REEL_LINK_SELECTOR);
    for (let i = 0; i < links.length; i++) {
      const link = links[i] as HTMLAnchorElement;
      const href = link.getAttribute("href");
      if (!isReelPermalinkHref(href) || tilesByHref.has(href)) continue;
      const tileRoot = resolveTileRoot(link, getHrefsForNode);
      if (!tileRoot) continue;
      tilesByHref.set(href, tileRoot);
    }
    return tilesByHref;
  }

  function applyFilteredLayout(): void {
    if (!_qualifyingHrefs) return;
    clearTileClasses();
    const tilesByHref = collectTileRootsByHref();
    const visibleCountByParent = new Map<HTMLElement, number>();
    const parents: HTMLElement[] = [];
    const seenParents = new Set<HTMLElement>();

    tilesByHref.forEach(function (tile, href) {
      const parent = tile.parentElement;
      if (parent && !seenParents.has(parent)) {
        seenParents.add(parent);
        parents.push(parent);
      }

      if (_qualifyingHrefs!.has(href)) {
        tile.classList.remove(HIDDEN_CLASS);
        tile.classList.add(VISIBLE_CELL_CLASS);
        if (parent) {
          const currentCount = visibleCountByParent.get(parent) ?? 0;
          visibleCountByParent.set(parent, currentCount + 1);
        }
      } else {
        tile.classList.add(HIDDEN_CLASS);
        tile.classList.remove(VISIBLE_CELL_CLASS);
      }
    });

    for (let i = 0; i < parents.length; i++) {
      const parent = parents[i]!;
      const visibleCount = visibleCountByParent.get(parent) ?? 0;
      if (visibleCount === 0) parent.classList.add(HIDDEN_ROW_CLASS);
      else parent.classList.remove(HIDDEN_ROW_CLASS);
    }

    if (_qualifyingHrefs.size === 0) {
      // Prevent endless bottom-loading when every tile is filtered out.
      lockPageScroll();
    } else {
      unlockPageScroll();
    }
  }

  function clearFilteredLayout(): void {
    _qualifyingHrefs = null;
    clearTileClasses();
    unlockPageScroll();
  }

  function startHideObserver(): void {
    stopHideObserver();
    let scheduled = false;
    _hideObserver = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        applyFilteredLayout();
      });
    });
    _hideObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopHideObserver(): void {
    if (_hideObserver) {
      _hideObserver.disconnect();
      _hideObserver = null;
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────
  function resetAll(): void {
    stopHideObserver();
    clearFilteredLayout();
    removeHideStyle();
    window.__outliers_active = false;
    emitReset();
  }

  window.__outliers_reset = resetAll;

  function stopScan(): void {
    _runGeneration++;
    window.scrollTo(0, 0);
    resetAll();
  }

  window.__outliers_stop = stopScan;

  // ── Error handling (sets state + sends to side panel) ──────────────────
  function reportError(errorText: string): void {
    stopHideObserver();
    clearFilteredLayout();
    removeHideStyle();
    window.__outliers_active = false;
    updateState({
      status: "error",
      followers: null,
      threshold: null,
      filterMode: FILTER_MODE,
      minViews: FILTER_MODE === "minViews" ? MIN_VIEWS : null,
      activeThresholdLabel: FILTER_MODE === "minViews" ? getActiveThresholdLabel(MIN_VIEWS) : "5× follower count",
      scannedCount: 0,
      scanLimit: SCAN_LIMIT,
      outliers: [],
      errorText: errorText,
    });
  }

  // ── Collect reels currently visible in the DOM into an accumulator map ─
  function collectVisibleReels(reelMap: Map<string, ReelData>): void {
    const links = document.querySelectorAll(REEL_LINK_SELECTOR);
    for (let li = 0; li < links.length; li++) {
      const link = links[li]! as HTMLAnchorElement;
      const href = link.getAttribute("href");
      if (!isReelPermalinkHref(href) || reelMap.has(href)) continue;

      const fullUrl = href.startsWith("http")
        ? href
        : "https://www.instagram.com" + href;

      let views = NaN;

      // Priority 1: aria-labels
      const ariaEls = link.querySelectorAll("[aria-label]");
      for (let a = 0; a < ariaEls.length; a++) {
        const label = ariaEls[a]?.getAttribute("aria-label") ?? "";
        const m = label.match(/([\d,.]+[KMBkmb]?)\s*(views|plays|play)/i);
        if (m) {
          views = parseCount(m[1]);
          if (!isNaN(views)) break;
        }
      }
      if (isNaN(views)) {
        const linkAria = link.getAttribute("aria-label") ?? "";
        const lm = linkAria.match(/([\d,.]+[KMBkmb]?)\s*(views|plays|play)/i);
        if (lm) views = parseCount(lm[1]);
      }

      // Priority 2: SVG play icon
      if (isNaN(views)) {
        const svgs = link.querySelectorAll("svg");
        for (let s = 0; s < svgs.length; s++) {
          const svg = svgs[s]!;
          if (isPlaySvg(svg) && !isHeartSvg(svg)) {
            const num = getNumberNearSvg(svg);
            if (!isNaN(num) && num > 0) {
              views = num;
              break;
            }
          }
        }
      }

      // Priority 3: non-heart SVG number
      if (isNaN(views)) {
        const svgs2 = link.querySelectorAll("svg");
        const candidates: { value: number; isHeart: boolean }[] = [];
        for (let s2 = 0; s2 < svgs2.length; s2++) {
          const svg = svgs2[s2]!;
          const n = getNumberNearSvg(svg);
          if (!isNaN(n) && n > 0) {
            candidates.push({ value: n, isHeart: isHeartSvg(svg) });
          }
        }
        for (let c = 0; c < candidates.length; c++) {
          if (!candidates[c]!.isHeart) {
            views = candidates[c]!.value;
            break;
          }
        }
        if (isNaN(views) && candidates.length >= 2) {
          views = candidates[0]!.value;
        }
      }

      // Priority 4: span numbers
      if (isNaN(views)) {
        const allSpans = link.querySelectorAll("span");
        const numbers: number[] = [];
        for (let sp = 0; sp < allSpans.length; sp++) {
          const txt = allSpans[sp]?.textContent?.trim() ?? "";
          if (/^[\d,.]+[KMBkmb]?$/.test(txt)) {
            const parsed = parseCount(txt);
            if (!isNaN(parsed) && parsed > 0) numbers.push(parsed);
          }
        }
        if (numbers.length === 1) {
          views = numbers[0]!;
        } else if (numbers.length >= 2) {
          numbers.sort(function (a, b) {
            return b - a;
          });
          views = numbers[0]!;
        }
      }

      reelMap.set(href, { url: fullUrl, href: href, views: views });
    }
  }

  // ── Auto-scroll to load all reels ──────────────────────────────────────
  function autoScrollAndRun(): void {
    _runGeneration++;
    const myGen = _runGeneration;
    clearFilteredLayout();
    removeHideStyle();

    const reelMap = new Map<string, ReelData>();
    let previousMapSize = 0;
    let stableRounds = 0;
    let scrollAttempts = 0;

    console.log("[outliers] autoScrollAndRun() started — gen:", myGen, "limit:", SCAN_LIMIT);

    updateState({
      status: "scanning",
      followers: null,
      threshold: null,
      filterMode: FILTER_MODE,
      minViews: FILTER_MODE === "minViews" ? MIN_VIEWS : null,
      activeThresholdLabel: FILTER_MODE === "minViews" ? getActiveThresholdLabel(MIN_VIEWS) : "5× follower count",
      scannedCount: 0,
      scanLimit: SCAN_LIMIT,
      outliers: [],
      errorText: null,
    });

    function scrollStep(): void {
      try {
        if (myGen !== _runGeneration) {
          console.log("[outliers] scrollStep aborted — stale generation", myGen, "vs", _runGeneration);
          return;
        }

        collectVisibleReels(reelMap);
        const currentSize = reelMap.size;

        if (currentSize > previousMapSize) {
          stableRounds = 0;
          previousMapSize = currentSize;
          updateState({
            status: "scanning",
            followers: null,
            threshold: null,
            filterMode: FILTER_MODE,
            minViews: FILTER_MODE === "minViews" ? MIN_VIEWS : null,
            activeThresholdLabel: FILTER_MODE === "minViews" ? getActiveThresholdLabel(MIN_VIEWS) : "5× follower count",
            scannedCount: currentSize,
            scanLimit: SCAN_LIMIT,
            outliers: [],
            errorText: null,
          });
        } else {
          stableRounds++;
        }

        scrollAttempts++;

        const reachedLimit = SCAN_LIMIT !== null && currentSize >= SCAN_LIMIT;
        if (reachedLimit || stableRounds >= 8 || scrollAttempts >= MAX_SCROLL_ATTEMPTS) {
          const reason = reachedLimit ? "limit reached" : stableRounds >= 8 ? "no new reels (stable x8)" : "max scroll attempts";
          console.log("[outliers] Scroll stopped —", reason, "| reels:", currentSize, "| scrolls:", scrollAttempts);
          window.scrollTo(0, 0);
          setTimeout(function () {
            if (myGen !== _runGeneration) return;
            analyzeFromMap(reelMap);
          }, 500);
          return;
        }

        if (scrollAttempts % 10 === 0) {
          console.log("[outliers] Scroll #" + scrollAttempts + " — reels: " + currentSize + ", stable: " + stableRounds);
        }

        window.scrollTo(0, window.scrollY + SCROLL_STEP_PX);
        setTimeout(scrollStep, SCROLL_WAIT_MS);
      } catch (err) {
        console.error("[outliers] Scroll loop error:", err);
        reportError("Scroll loop error — please try again.");
      }
    }

    scrollStep();
  }

  // ── Analysis using accumulated reel map ────────────────────────────────
  function analyzeFromMap(reelMap: Map<string, ReelData>): void {
    console.log("[outliers] analyzeFromMap() — reels collected:", reelMap.size);
    const followers = getFollowerCount();
    console.log("[outliers] Followers detected:", followers);
    if (isNaN(followers) || followers <= 0) {
      reportError(
        "Can\u2019t read followers on this profile. The follower count may not be visible on this page."
      );
      return;
    }

    const threshold = FILTER_MODE === "minViews" ? MIN_VIEWS : followers * MULTIPLIER;
    const activeThresholdLabel = getActiveThresholdLabel(threshold);
    const allReels: ReelData[] = [];
    reelMap.forEach(function (reel) {
      allReels.push(reel);
    });
    const reelsWithViews = allReels.filter(function (r) {
      return !isNaN(r.views);
    });

    if (reelsWithViews.length === 0) {
      reportError(
        "Can\u2019t read views on this profile. View counts may not be displayed on these Reel thumbnails."
      );
      return;
    }

    const qualifying = reelsWithViews
      .filter(function (r) {
        return r.views >= threshold;
      })
      .sort(function (a, b) {
        return b.views - a.views;
      });

    _qualifyingHrefs = new Set<string>();
    const outliers: OutliersEntry[] = [];
    for (let i = 0; i < qualifying.length; i++) {
      const reel = qualifying[i]!;
      _qualifyingHrefs.add(reel.href);
      outliers.push({
        url: reel.url,
        href: reel.href,
        views: reel.views,
        ratio: reel.views / followers,
      });
    }

    injectHideStyle();
    applyFilteredLayout();
    if (qualifying.length === 0) {
      stopHideObserver();
    } else {
      startHideObserver();
    }

    updateState({
      status: "done",
      followers: followers,
      threshold: threshold,
      filterMode: FILTER_MODE,
      minViews: FILTER_MODE === "minViews" ? MIN_VIEWS : null,
      activeThresholdLabel: activeThresholdLabel,
      scannedCount: allReels.length,
      scanLimit: SCAN_LIMIT,
      outliers: outliers,
      errorText: null,
    });
  }

  // ── Main entry ─────────────────────────────────────────────────────────
  function run(): void {
    const url = window.location.href;
    const onReels = isReelsPage();
    console.log("[outliers] run() — URL:", url, "isReelsPage:", onReels);

    if (!onReels) {
      const onProfile = /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/?$/.test(url);
      const msg = onProfile
        ? 'Please navigate to the Reels tab of this profile first. Click the "Reels" tab (film icon) on the profile, then try again.'
        : "Please open an Instagram profile\u2019s Reels tab first. Example: instagram.com/username/reels/";
      reportError(msg);
      return;
    }

    autoScrollAndRun();
  }

  run();
}

init();
