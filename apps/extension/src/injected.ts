import { parseCount } from "./shared/parse-count";
import { buildEmptyStateCopy } from "./shared/empty-state-copy";
import type { OutliersState, OutliersEntry, FilterMode } from "./types/state";

interface CollectedReel {
  url: string;
  href: string;
  views: number; // NaN if views could not be parsed
  cardHtml: string | null;
  thumbnailUrl: string | null;
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
  const _movedTiles = new Map<HTMLElement, { parent: HTMLElement; next: ChildNode | null }>();

  const runCtx = {
    reelMap: new Map<string, CollectedReel>(),
    isStopRequested: false,
    isFinalizing: false,
    previousMapSize: 0,
    stableRounds: 0,
    scrollAttempts: 0,
  };

  const SCAN_LIMIT: number | null = window.__outliers_scan_limit ?? null;
  const FILTER_MODE: FilterMode = window.__outliers_filter_mode === "minViews" ? "minViews" : "ratio5x";
  const MIN_VIEWS: number = window.__outliers_min_views && window.__outliers_min_views > 0
    ? window.__outliers_min_views
    : 10000;

  const MULTIPLIER = 5;
  const MAX_CARD_SNAPSHOT_REELS = 150;
  const SCROLL_STEP_PX = 600;
  const SCROLL_WAIT_MS = 800;
  const MAX_SCROLL_ATTEMPTS = 500;
  const REEL_HREF_RE = /\/reel(s)?\/[^/?#]+/i;
  const REEL_LINK_SELECTOR = 'a[href*="/reel/"], a[href*="/reels/"]';

  const APP_ROOT_ID = "outliers-grid-root";
  const APP_STYLE_ID = "outliers-app-style";
  const LOCK_ID = "outliers-interaction-lock";

  let _interactionBlocker: ((ev: Event) => void) | null = null;

  function getActiveThresholdLabel(threshold: number): string {
    if (FILTER_MODE === "minViews") return threshold.toLocaleString("en-US") + " views";
    return threshold.toLocaleString("en-US") + " views";
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

  function isReelsPage(): boolean {
    const url = window.location.href;
    if (/\/(explore|p|stories|direct)\//i.test(url)) return false;
    return /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/reels\/?(\?.*)?$/.test(url);
  }

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

  function resolveTileRoot(link: HTMLAnchorElement): HTMLElement | null {
    const hrefCache = new WeakMap<Element, Set<string>>();
    const getHrefsForNode = function (node: Element): Set<string> {
      const cached = hrefCache.get(node);
      if (cached) return cached;
      const computed = collectUniqueReelHrefs(node);
      hrefCache.set(node, computed);
      return computed;
    };

    let current: HTMLElement | null = link;
    while (current && current !== document.body) {
      const parentEl: HTMLElement | null = current.parentElement;
      if (!parentEl) break;

      const currentHrefs = getHrefsForNode(current);
      let siblingTileCount = 0;
      for (let i = 0; i < parentEl.children.length; i++) {
        const sibling = parentEl.children[i]!;
        const siblingHrefs = getHrefsForNode(sibling);
        if (siblingHrefs.size === 1) siblingTileCount++;
      }

      const display = window.getComputedStyle(current).display;
      const rect = current.getBoundingClientRect();
      const looksLikeTileSize = rect.width >= 60 && rect.height >= 60;

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

    return (link.closest("article, li") as HTMLElement | null) ?? link;
  }

  function collectTileRootsByHref(): Map<string, HTMLElement> {
    const tilesByHref = new Map<string, HTMLElement>();
    const links = document.querySelectorAll(REEL_LINK_SELECTOR);
    for (let i = 0; i < links.length; i++) {
      const link = links[i] as HTMLAnchorElement;
      const href = link.getAttribute("href");
      if (!isReelPermalinkHref(href) || tilesByHref.has(href)) continue;
      const tileRoot = resolveTileRoot(link);
      if (!tileRoot) continue;
      tilesByHref.set(href, tileRoot);
    }
    return tilesByHref;
  }

  function pickFirstSrcsetUrl(srcset: string | null): string | null {
    if (!srcset) return null;
    const first = srcset.split(",")[0]?.trim() ?? "";
    if (!first) return null;
    const firstUrl = first.split(/\s+/)[0]?.trim() ?? "";
    return firstUrl || null;
  }

  function readThumbnailUrl(link: HTMLAnchorElement): string | null {
    const img = link.querySelector("img") as HTMLImageElement | null;
    if (!img) return null;
    const current = (img.currentSrc ?? "").trim();
    if (current) return current;
    const src = (img.getAttribute("src") ?? "").trim();
    if (src) return src;
    return pickFirstSrcsetUrl(img.getAttribute("srcset"));
  }

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

  function ensureAppStyle(): void {
    if (document.getElementById(APP_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = APP_STYLE_ID;
    style.textContent = [
      "#" + APP_ROOT_ID + " {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  padding: 20px 16px 40px;",
      "  display: block;",
      "  font-family: 'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', 'Chalkboard', 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif !important;",
      "}",
      "#" + APP_ROOT_ID + ",",
      "#" + APP_ROOT_ID + " * {",
      "  font-family: 'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', 'Chalkboard', 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif !important;",
      "}",
      "#" + APP_ROOT_ID + " .outliers-app-shell {",
      "  width: min(935px, 100%);",
      "  margin: 0 auto;",
      "  color: #262626;",
      "}",
      "#" + APP_ROOT_ID + " .outliers-app-header {",
      "  display: flex;",
      "  justify-content: space-between;",
      "  align-items: baseline;",
      "  gap: 12px;",
      "  margin-bottom: 14px;",
      "}",
      "#" + APP_ROOT_ID + " .outliers-app-title {",
      "  font-size: 18px;",
      "  font-weight: 700;",
      "}",
      "#" + APP_ROOT_ID + " .outliers-app-meta {",
      "  font-size: 13px;",
      "  color: #737373;",
      "  text-align: right;",
      "}",
      "#" + APP_ROOT_ID + " .outliers-app-grid {",
      "  display: grid;",
      "  grid-template-columns: repeat(2, minmax(0, 1fr));",
      "  gap: 8px;",
      "}",
      "#" + APP_ROOT_ID + " .outliers-empty {",
      "  max-width: 720px;",
      "  margin: 24px auto 0;",
      "  padding: 22px 24px;",
      "  border: 1px solid rgba(0, 0, 0, 0.08);",
      "  border-radius: 18px;",
      "  background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(247,247,247,0.92));",
      "  text-align: center;",
      "  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.06);",
      "}",
      "#" + APP_ROOT_ID + " .outliers-empty-title {",
      "  font-size: 22px;",
      "  font-weight: 700;",
      "  line-height: 1.25;",
      "}",
      "#" + APP_ROOT_ID + " .outliers-empty-detail {",
      "  margin-top: 10px;",
      "  font-size: 17px;",
      "  line-height: 1.5;",
      "  color: #5b5b5b;",
      "}",
      "@media (min-width: 760px) {",
      "  #" + APP_ROOT_ID + " .outliers-app-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }",
      "}",
      "@media (min-width: 1080px) {",
      "  #" + APP_ROOT_ID + " .outliers-app-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }",
      "}",
      "#" + APP_ROOT_ID + " .outliers-card {",
      "  min-width: 0;",
      "}",
      "#" + APP_ROOT_ID + " .outliers-card > * {",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  flex: 0 0 auto !important;",
      "}",
      "#" + APP_ROOT_ID + " .outliers-card img {",
      "  width: 100%;",
      "  display: block;",
      "}",
      "#" + LOCK_ID + " {",
      "  position: fixed !important;",
      "  inset: 0 !important;",
      "  z-index: 2147483647 !important;",
      "  background: rgba(34, 197, 94, 0.18) !important;",
      "  backdrop-filter: saturate(120%);",
      "  pointer-events: auto !important;",
      "  cursor: progress;",
      "}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function removeAppStyle(): void {
    const style = document.getElementById(APP_STYLE_ID);
    if (style) style.remove();
  }

  function findReelsGridHost(): HTMLElement | null {
    // Primary strategy: use the tabs line as boundary and take the content block below it.
    const tablist = document.querySelector('main [role="tablist"]') as HTMLElement | null;
    if (tablist) {
      let current: HTMLElement | null = tablist;
      while (current && current.tagName !== "MAIN") {
        const parentEl: HTMLElement | null = current.parentElement;
        if (!parentEl) break;

        let sibling = current.nextElementSibling as HTMLElement | null;
        while (sibling) {
          if (sibling.querySelector(REEL_LINK_SELECTOR)) {
            return sibling;
          }
          sibling = sibling.nextElementSibling as HTMLElement | null;
        }

        current = parentEl;
      }
    }

    // Fallback: derive host from existing reel links.
    const links = document.querySelectorAll(REEL_LINK_SELECTOR);
    if (links.length === 0) return null;

    const firstLink = links[0] as HTMLAnchorElement;
    let node: HTMLElement | null = firstLink.parentElement;
    let candidate: HTMLElement | null = null;

    while (node && node !== document.body) {
      if (node.tagName === "MAIN") break;
      const reelCount = node.querySelectorAll(REEL_LINK_SELECTOR).length;
      const hasTabList = !!node.querySelector('[role="tablist"]');
      const hasHeader = !!node.querySelector("header");
      if (reelCount >= 6 && !hasTabList && !hasHeader) {
        candidate = node;
      }
      node = node.parentElement;
    }

    return candidate;
  }

  function hideReelsGridHost(): void {
    if (_gridHost && _gridHost.isConnected) {
      _gridHost.style.setProperty("display", "none", "important");
      _gridHost.setAttribute("aria-hidden", "true");
      return;
    }

    const host = findReelsGridHost();
    if (!host) {
      if (_hiddenBelowTabs.length > 0) return;
      const tablist = document.querySelector('main [role="tablist"]') as HTMLElement | null;
      if (!tablist?.parentElement) return;

      let sibling = tablist.nextElementSibling as HTMLElement | null;
      while (sibling) {
        _hiddenBelowTabs.push({ el: sibling, display: sibling.style.display });
        sibling.style.setProperty("display", "none", "important");
        sibling.setAttribute("aria-hidden", "true");
        sibling = sibling.nextElementSibling as HTMLElement | null;
      }
      return;
    }

    _gridHost = host;
    _gridHostDisplayBefore = _gridHost.style.display;
    _gridHost.style.setProperty("display", "none", "important");
    _gridHost.setAttribute("aria-hidden", "true");
  }

  function restoreMovedTiles(): void {
    _movedTiles.forEach(function (origin, tile) {
      if (!origin.parent.isConnected) return;
      const targetNext = origin.next && origin.parent.contains(origin.next) ? origin.next : null;
      if (targetNext) {
        origin.parent.insertBefore(tile, targetNext);
      } else {
        origin.parent.appendChild(tile);
      }
    });
    _movedTiles.clear();
  }

  function showReelsGridHost(): void {
    restoreMovedTiles();

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

    const host = _gridHost ?? findReelsGridHost();
    if (host?.parentElement) {
      host.parentElement.insertBefore(root, host.nextSibling);
    } else {
      const tablist = document.querySelector('main [role="tablist"]') as HTMLElement | null;
      if (tablist?.parentElement) {
        tablist.parentElement.insertBefore(root, tablist.nextSibling);
      } else {
        const main = document.querySelector('main[role="main"], main') as HTMLElement | null;
        if (main) {
          main.appendChild(root);
        } else {
          document.body.appendChild(root);
        }
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
    if (lock) {
      lock.remove();
    }
    if (_interactionBlocker) {
      document.removeEventListener("keydown", _interactionBlocker, { capture: true });
      _interactionBlocker = null;
    }
  }

  function resetRunContext(): void {
    runCtx.reelMap.clear();
    runCtx.isStopRequested = false;
    runCtx.isFinalizing = false;
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

  function pruneHiddenReelsContent(): void {
    if (_gridHost) {
      _gridHost.replaceChildren();
    }
    for (let i = 0; i < _hiddenBelowTabs.length; i++) {
      _hiddenBelowTabs[i]!.el.replaceChildren();
    }
  }

  function didNativeModalOpen(dialogsBefore: number, pathBefore: string): boolean {
    const dialogsAfter = document.querySelectorAll('div[role="dialog"]').length;
    if (dialogsAfter > dialogsBefore) return true;

    const pathAfter = window.location.pathname;
    if (pathAfter !== pathBefore && /\/reel(s)?\//i.test(pathAfter)) return true;

    return false;
  }

  function sanitizeCapturedHtml(rawHtml: string): DocumentFragment {
    const template = document.createElement("template");
    template.innerHTML = rawHtml;

    const blockedTags = new Set([
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "style",
      "form",
      "base",
      "noscript",
      "template",
    ]);
    const dangerousUrlAttrs = new Set([
      "href",
      "src",
      "xlink:href",
      "action",
      "formaction",
      "poster",
      "srcset",
    ]);

    const normalizeUrlValue = function (value: string): string {
      let out = value;
      for (let i = 0; i < 2; i++) {
        try {
          const decoded = decodeURIComponent(out);
          if (decoded === out) break;
          out = decoded;
        } catch {
          break;
        }
      }
      return out.toLowerCase().replace(/[\u0000-\u001f\u007f\s]+/g, "");
    };

    const isDangerousUrl = function (value: string): boolean {
      const normalized = normalizeUrlValue(value);
      return normalized.startsWith("javascript:") || normalized.startsWith("data:");
    };

    const elements = template.content.querySelectorAll("*");
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]!;
      const tag = el.tagName.toLowerCase();
      if (blockedTags.has(tag)) {
        el.remove();
        continue;
      }

      const attrs = Array.from(el.attributes);
      for (let a = 0; a < attrs.length; a++) {
        const attr = attrs[a]!;
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }

        if (!dangerousUrlAttrs.has(name)) continue;

        if (name === "srcset") {
          const parts = attr.value.split(",");
          let unsafe = false;
          for (let p = 0; p < parts.length; p++) {
            const candidate = parts[p]!.trim().split(/\s+/)[0] ?? "";
            if (candidate && isDangerousUrl(candidate)) {
              unsafe = true;
              break;
            }
          }
          if (unsafe) el.removeAttribute(attr.name);
          continue;
        }

        if (isDangerousUrl(attr.value) || value.startsWith("javascript:") || value.startsWith("data:")) {
          el.removeAttribute(attr.name);
        }
      }
    }

    return template.content;
  }

  function renderCustomGrid(
    outliers: OutliersEntry[],
    scannedCount: number,
    thresholdLabel: string,
    followers: number,
    threshold: number
  ): void {
    ensureAppStyle();
    restoreMovedTiles();
    const liveTilesByHref = collectTileRootsByHref();
    hideReelsGridHost();

    const root = getOrCreateAppRoot();
    root.innerHTML = "";

    const shell = document.createElement("div");
    shell.className = "outliers-app-shell";

    const header = document.createElement("div");
    header.className = "outliers-app-header";

    const title = document.createElement("div");
    title.className = "outliers-app-title";
    title.textContent = "Outliers";

    const meta = document.createElement("div");
    meta.className = "outliers-app-meta";
    meta.textContent = outliers.length + " of " + scannedCount + " reels • " + thresholdLabel;

    header.appendChild(title);
    header.appendChild(meta);

    shell.appendChild(header);

    if (outliers.length === 0) {
      const copy = buildEmptyStateCopy({
        filterMode: FILTER_MODE,
        followers,
        threshold,
        minViews: FILTER_MODE === "minViews" ? MIN_VIEWS : null,
        scanLimit: SCAN_LIMIT,
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
      pruneHiddenReelsContent();
      runCtx.reelMap.clear();
      _movedTiles.clear();
      return;
    }

    const grid = document.createElement("div");
    grid.className = "outliers-app-grid";

    for (let i = 0; i < outliers.length; i++) {
      const item = outliers[i]!;
      const fromMap = runCtx.reelMap.get(item.href);
      const liveTile = liveTilesByHref.get(item.href);

      const card = document.createElement("div");
      card.className = "outliers-card";

      if (liveTile) {
        const parent = liveTile.parentElement;
        if (parent && !_movedTiles.has(liveTile)) {
          _movedTiles.set(liveTile, {
            parent,
            next: liveTile.nextSibling,
          });
        }
        card.appendChild(liveTile);
        card.addEventListener(
          "click",
          function (ev) {
            const mouse = ev as MouseEvent;
            if (mouse.button !== 0) return;
            if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) {
              ev.preventDefault();
              ev.stopPropagation();
              ev.stopImmediatePropagation();
              window.open(item.url, "_blank", "noopener,noreferrer");
              return;
            }

            const dialogsBefore = document.querySelectorAll('div[role="dialog"]').length;
            const pathBefore = window.location.pathname;

            // Block hard navigation in current tab, but keep propagation so Instagram handlers can still open modal.
            ev.preventDefault();

            window.setTimeout(function () {
              if (didNativeModalOpen(dialogsBefore, pathBefore)) return;
              window.open(item.url, "_blank", "noopener,noreferrer");
            }, 500);
          },
          true
        );
        card.addEventListener(
          "auxclick",
          function (ev) {
            const mouse = ev as MouseEvent;
            if (mouse.button !== 1) return;
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            window.open(item.url, "_blank", "noopener,noreferrer");
          },
          true
        );
      } else if (fromMap?.cardHtml) {
        card.appendChild(sanitizeCapturedHtml(fromMap.cardHtml));
        const anchors = card.querySelectorAll("a[href]");
        for (let ai = 0; ai < anchors.length; ai++) {
          const a = anchors[ai] as HTMLAnchorElement;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
      } else {
        const fallbackLink = document.createElement("a");
        fallbackLink.href = item.url;
        fallbackLink.target = "_blank";
        fallbackLink.rel = "noopener noreferrer";
        fallbackLink.textContent = "Open reel";
        card.appendChild(fallbackLink);
      }
      grid.appendChild(card);
    }

    shell.appendChild(grid);
    root.appendChild(shell);
    pruneHiddenReelsContent();
    runCtx.reelMap.clear();
    _movedTiles.clear();
  }

  function reportError(errorText: string): void {
    cancelPendingScroll();
    hideInteractionLock();
    removeAppRoot();
    removeAppStyle();
    showReelsGridHost();
    window.__outliers_active = false;

    updateState({
      status: "error",
      phase: "rendered",
      followers: null,
      threshold: null,
      filterMode: FILTER_MODE,
      minViews: FILTER_MODE === "minViews" ? MIN_VIEWS : null,
      activeThresholdLabel: FILTER_MODE === "minViews" ? getActiveThresholdLabel(MIN_VIEWS) : "5× follower count",
      scannedCount: runCtx.reelMap.size,
      scanLimit: SCAN_LIMIT,
      outliers: [],
      errorText,
    });
  }

  function collectVisibleReels(reelMap: Map<string, CollectedReel>): void {
    const links = document.querySelectorAll(REEL_LINK_SELECTOR);

    for (let li = 0; li < links.length; li++) {
      const link = links[li]! as HTMLAnchorElement;
      const href = link.getAttribute("href");
      if (!isReelPermalinkHref(href)) continue;

      const fullUrl = href.startsWith("http")
        ? href
        : "https://www.instagram.com" + href;
      const thumbnailUrl = readThumbnailUrl(link);

      let views = NaN;

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

      const existing = reelMap.get(href);
      if (!existing) {
        const snapshot = reelMap.size < MAX_CARD_SNAPSHOT_REELS
          ? (resolveTileRoot(link)?.outerHTML ?? null)
          : null;
        reelMap.set(href, {
          url: fullUrl,
          href,
          views,
          cardHtml: snapshot,
          thumbnailUrl,
        });
        continue;
      }

      if (isNaN(existing.views) && !isNaN(views)) {
        existing.views = views;
      }
      if (!existing.cardHtml && reelMap.size < MAX_CARD_SNAPSHOT_REELS) {
        const snapshot = resolveTileRoot(link)?.outerHTML ?? null;
        if (snapshot) existing.cardHtml = snapshot;
      }
      if (!existing.thumbnailUrl && thumbnailUrl) {
        existing.thumbnailUrl = thumbnailUrl;
      }
    }
  }

  function buildProgressSnapshot(
    reelMap: Map<string, CollectedReel>,
    phase: "scanning" | "analyzing",
    scannedCount: number
  ): OutliersState {
    const followersRaw = getFollowerCount();
    const followers = !isNaN(followersRaw) && followersRaw > 0 ? followersRaw : null;
    const threshold = FILTER_MODE === "minViews"
      ? MIN_VIEWS
      : followers
        ? followers * MULTIPLIER
        : null;
    const activeThresholdLabel = threshold !== null
      ? getActiveThresholdLabel(threshold)
      : "5× follower count";

    const allReels: CollectedReel[] = [];
    reelMap.forEach(function (reel) {
      allReels.push(reel);
    });

    const reelsWithViews = allReels.filter(function (r) {
      return !isNaN(r.views);
    });

    const qualifying = threshold === null
      ? []
      : reelsWithViews
        .filter(function (r) {
          return r.views >= threshold;
        })
        .sort(function (a, b) {
          return b.views - a.views;
        });

    const outliers: OutliersEntry[] = [];
    for (let i = 0; i < qualifying.length; i++) {
      const reel = qualifying[i]!;
      outliers.push({
        url: reel.url,
        href: reel.href,
        views: reel.views,
        ratio: followers ? reel.views / followers : 0,
        thumbnailUrl: reel.thumbnailUrl,
      });
    }

    return {
      status: "scanning",
      phase: phase,
      followers,
      threshold,
      filterMode: FILTER_MODE,
      minViews: FILTER_MODE === "minViews" ? MIN_VIEWS : null,
      activeThresholdLabel,
      scannedCount,
      scanLimit: SCAN_LIMIT,
      outliers,
      errorText: null,
    };
  }

  function analyzeFromMap(reelMap: Map<string, CollectedReel>, myGen: number): void {
    if (myGen !== _runGeneration) return;

    console.log("[outliers] analyzeFromMap() — reels collected:", reelMap.size);
    const followers = getFollowerCount();
    if (isNaN(followers) || followers <= 0) {
      reportError("Can’t read followers on this profile. The follower count may not be visible on this page.");
      return;
    }

    const threshold = FILTER_MODE === "minViews" ? MIN_VIEWS : followers * MULTIPLIER;
    const activeThresholdLabel = getActiveThresholdLabel(threshold);

    const allReels: CollectedReel[] = [];
    reelMap.forEach(function (reel) {
      allReels.push(reel);
    });

    const reelsWithViews = allReels.filter(function (r) {
      return !isNaN(r.views);
    });

    if (reelsWithViews.length === 0) {
      reportError("Can’t read views on this profile. View counts may not be displayed on these Reel thumbnails.");
      return;
    }

    const qualifying = reelsWithViews
      .filter(function (r) {
        return r.views >= threshold;
      })
      .sort(function (a, b) {
        return b.views - a.views;
      });

    const outliers: OutliersEntry[] = [];
    for (let i = 0; i < qualifying.length; i++) {
      const reel = qualifying[i]!;
      outliers.push({
        url: reel.url,
        href: reel.href,
        views: reel.views,
        ratio: reel.views / followers,
        thumbnailUrl: reel.thumbnailUrl,
      });
    }

    renderCustomGrid(outliers, allReels.length, activeThresholdLabel, followers, threshold);
    hideInteractionLock();

    updateState({
      status: "done",
      phase: "rendered",
      followers,
      threshold,
      filterMode: FILTER_MODE,
      minViews: FILTER_MODE === "minViews" ? MIN_VIEWS : null,
      activeThresholdLabel,
      scannedCount: allReels.length,
      scanLimit: SCAN_LIMIT,
      outliers,
      errorText: null,
    });
  }

  function finalizeFromCurrentMap(myGen: number): void {
    if (myGen !== _runGeneration) return;
    if (runCtx.isFinalizing) return;

    runCtx.isFinalizing = true;
    cancelPendingScroll();
    collectVisibleReels(runCtx.reelMap);
    // Emit one last progressive snapshot before final render so the side panel stays live.
    updateState(buildProgressSnapshot(runCtx.reelMap, "analyzing", runCtx.reelMap.size));

    window.scrollTo(0, 0);
    _scrollTimer = window.setTimeout(function () {
      _scrollTimer = null;
      if (myGen !== _runGeneration) return;
      analyzeFromMap(runCtx.reelMap, myGen);
    }, 80);
  }

  function autoScrollAndRun(): void {
    _runGeneration++;
    const myGen = _runGeneration;

    resetRunContext();
    removeAppRoot();
    showReelsGridHost();
    ensureAppStyle();
    showInteractionLock();

    updateState(buildProgressSnapshot(runCtx.reelMap, "scanning", 0));

    function scrollStep(): void {
      try {
        if (myGen !== _runGeneration) return;
        if (runCtx.isStopRequested) {
          finalizeFromCurrentMap(myGen);
          return;
        }

        collectVisibleReels(runCtx.reelMap);
        const currentSize = runCtx.reelMap.size;

        if (currentSize > runCtx.previousMapSize) {
          runCtx.stableRounds = 0;
          runCtx.previousMapSize = currentSize;
          // Stream partial outliers while scanning so users can see progress in real time.
          updateState(buildProgressSnapshot(runCtx.reelMap, "scanning", currentSize));
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
    _movedTiles.clear();
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

  function run(): void {
    const url = window.location.href;
    const onReels = isReelsPage();
    console.log("[outliers] run() — URL:", url, "isReelsPage:", onReels);

    if (!onReels) {
      const onProfile = /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/?$/.test(url);
      const msg = onProfile
        ? 'Please navigate to the Reels tab of this profile first. Click the "Reels" tab (film icon) on the profile, then try again.'
        : "Please open an Instagram profile’s Reels tab first. Example: instagram.com/username/reels/";
      reportError(msg);
      return;
    }

    autoScrollAndRun();
  }

  run();
}

init();
