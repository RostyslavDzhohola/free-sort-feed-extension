import { parseCount, formatCount } from "./shared/parse-count";
import type { ReelData } from "./types/reel";

// esbuild wraps this file in an IIFE, so all top-level code is scoped.
// We use an init() function with a double-injection guard.

function init(): void {
  if (window.__reels5x_active) return;
  window.__reels5x_active = true;

  let _runGeneration = 0;

  // ── Constants ──────────────────────────────────────────────────────────
  const MULTIPLIER = 5;
  const HIDDEN_CLASS = "reels5x-hidden";
  const OVERLAY_ID = "reels5x-overlay";
  const SCROLL_STEP_PX = 600;
  const SCROLL_WAIT_MS = 800;
  const MAX_SCROLL_ATTEMPTS = 500; // safety cap

  // ── State ──────────────────────────────────────────────────────────────
  let _hideObserver: MutationObserver | null = null;
  let _qualifyingHrefs: Set<string> | null = null;

  // ── Page detection ─────────────────────────────────────────────────────
  function isReelsPage(): boolean {
    const url = window.location.href;
    if (/\/(explore|p|stories|direct)\//i.test(url)) return false;
    return /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/reels\/?(\?.*)?$/.test(
      url
    );
  }

  // ── SVG classification ─────────────────────────────────────────────────
  // Distinguish play (triangle) icons from heart (like) icons
  function isHeartSvg(svg: SVGSVGElement): boolean {
    const label = (svg.getAttribute("aria-label") ?? "").toLowerCase();
    if (/like|heart|unlik/.test(label)) return true;
    const parentLabel = svg.parentElement
      ? (svg.parentElement.getAttribute("aria-label") ?? "").toLowerCase()
      : "";
    if (/like|heart|unlik/.test(parentLabel)) return true;

    // Check SVG path data — hearts have curved paths (C/c/Q/q commands)
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

    // Play icons are typically simple triangles (polygon) or short paths
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

  // ── Follower extraction ────────────────────────────────────────────────
  function getFollowerCount(): number {
    // Strategy 1 (primary): DOM — followers link contains the exact count
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

    // Strategy 2 (fallback): header text containing "followers"
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

    // Strategy 3 (last resort): meta og:description — can be stale/rounded
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

  // ── DOM helper ─────────────────────────────────────────────────────────
  interface MakeElAttrs {
    textContent?: string;
    className?: string;
    style?: string;
    [key: string]: string | undefined;
  }

  function makeEl(
    tag: string,
    attrs?: MakeElAttrs | null,
    children?: (Node | string | null)[]
  ): HTMLElement {
    const node = document.createElement(tag);
    if (attrs) {
      const keys = Object.keys(attrs);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        const val = attrs[key];
        if (val === undefined) continue;
        if (key === "textContent") node.textContent = val;
        else if (key === "className") node.className = val;
        else if (key === "style") node.style.cssText = val;
        else node.setAttribute(key, val);
      }
    }
    if (children) {
      for (let j = 0; j < children.length; j++) {
        const child = children[j];
        if (typeof child === "string")
          node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
      }
    }
    return node;
  }

  // ── Error overlay (non-blocking replacement for alert()) ──────────────
  function showError(message: string): void {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    const host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.style.cssText =
      "position:fixed;top:80px;right:16px;z-index:999999;width:340px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

    const shadow = host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = [
      ":host { all: initial; }",
      "* { box-sizing: border-box; margin: 0; padding: 0; }",
      ".box { background:#fff; border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,0.18); overflow:hidden; }",
      ".header { padding:12px 16px; background:#ed4956; color:#fff; font-size:14px; font-weight:700; }",
      ".body { padding:14px 16px; font-size:13px; color:#262626; line-height:1.5; white-space:pre-line; }",
      ".footer { padding:10px 16px; border-top:1px solid #efefef; text-align:right; }",
      ".dismiss { padding:6px 16px; border:none; border-radius:6px; background:#ed4956; color:#fff; font-size:13px; font-weight:600; cursor:pointer; }",
      ".dismiss:hover { opacity:0.85; }",
    ].join("\n");
    shadow.appendChild(styleEl);

    const dismissBtn = makeEl("button", {
      className: "dismiss",
      textContent: "Dismiss",
    });
    dismissBtn.addEventListener("click", function () {
      host.remove();
    });

    const box = makeEl("div", { className: "box" }, [
      makeEl("div", {
        className: "header",
        textContent: "Reels 5\u00d7 Filter",
      }),
      makeEl("div", { className: "body", textContent: message }),
      makeEl("div", { className: "footer" }, [dismissBtn]),
    ]);
    shadow.appendChild(box);
    document.body.appendChild(host);
  }

  // ── Progress overlay (shown during scroll phase) ───────────────────────
  function showProgress(message: string): void {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    const host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.style.cssText =
      "position:fixed;top:80px;right:16px;z-index:999999;width:320px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

    const shadow = host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = [
      ":host { all: initial; }",
      ".box { background:#fff; border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,0.18); padding:16px; }",
      ".title { font-size:14px; font-weight:700; color:#262626; margin-bottom:8px; }",
      ".msg { font-size:13px; color:#8e8e8e; }",
      ".spinner { display:inline-block; width:14px; height:14px; border:2px solid #dbdbdb; border-top-color:#0095f6; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle; }",
      "@keyframes spin { to { transform:rotate(360deg); } }",
    ].join("\n");
    shadow.appendChild(styleEl);

    const box = makeEl("div", { className: "box" }, [
      makeEl("div", { className: "title", textContent: "Reels 5\u00d7 Filter" }),
      makeEl("div", { className: "msg" }, [
        makeEl("span", { className: "spinner" }),
        message,
      ]),
    ]);
    shadow.appendChild(box);
    document.body.appendChild(host);
  }

  // ── Overlay rendering (Shadow DOM) ─────────────────────────────────────
  function renderOverlay(
    followers: number,
    threshold: number,
    qualifying: ReelData[],
    totalScanned: number
  ): void {
    removeOverlay();

    const host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.style.cssText =
      "position:fixed;top:80px;right:16px;z-index:999999;width:360px;max-height:80vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

    const shadow = host.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = [
      ":host { all: initial; }",
      "* { box-sizing: border-box; margin: 0; padding: 0; }",
      ".panel { background:#fff; border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,0.18); overflow:hidden; display:flex; flex-direction:column; max-height:80vh; }",
      ".header { padding:14px 16px; background:#0095f6; color:#fff; }",
      ".header h2 { font-size:15px; font-weight:700; margin-bottom:6px; }",
      ".header .meta { font-size:12px; opacity:0.9; line-height:1.4; }",
      ".list { overflow-y:auto; flex:1; padding:8px 0; }",
      ".item { display:flex; align-items:center; padding:10px 16px; border-bottom:1px solid #efefef; gap:10px; }",
      ".item:last-child { border-bottom:none; }",
      ".rank { font-size:14px; font-weight:700; color:#8e8e8e; min-width:24px; }",
      ".info { flex:1; min-width:0; }",
      ".views { font-size:14px; font-weight:600; color:#262626; }",
      ".ratio { font-size:12px; color:#0095f6; }",
      ".actions { display:flex; gap:6px; }",
      ".btn { padding:5px 10px; border:1px solid #dbdbdb; border-radius:6px; background:#fff; font-size:12px; cursor:pointer; color:#262626; text-decoration:none; white-space:nowrap; }",
      ".btn:hover { background:#fafafa; }",
      ".btn.open { background:#0095f6; color:#fff; border-color:#0095f6; }",
      ".empty { padding:24px 16px; text-align:center; color:#8e8e8e; font-size:13px; }",
      ".footer { padding:10px 16px; border-top:1px solid #efefef; text-align:center; }",
      ".close-btn { padding:6px 16px; border:none; border-radius:6px; background:#ed4956; color:#fff; font-size:13px; font-weight:600; cursor:pointer; }",
      ".close-btn:hover { opacity:0.85; }",
    ].join("\n");
    shadow.appendChild(styleEl);

    const outlierText =
      qualifying.length +
      " outlier" +
      (qualifying.length !== 1 ? "s" : "") +
      " found";
    const scannedText = "(scanned " + totalScanned + " reels)";

    const headerH2 = makeEl("h2", {
      textContent: "Reels 5\u00d7 Outliers",
    });
    const metaDiv = makeEl("div", { className: "meta" }, [
      "Followers: " +
        formatCount(followers) +
        " \u00b7 Threshold: " +
        formatCount(threshold) +
        " views",
      document.createElement("br"),
      outlierText + " " + scannedText,
    ]);
    const header = makeEl("div", { className: "header" }, [headerH2, metaDiv]);

    const list = makeEl("div", { className: "list" });

    if (qualifying.length === 0) {
      list.appendChild(
        makeEl("div", {
          className: "empty",
          textContent: "No Reels reached the 5\u00d7 threshold.",
        })
      );
    } else {
      qualifying.forEach(function (reel, i) {
        const ratio = (reel.views / followers).toFixed(1);
        const rank = makeEl("span", {
          className: "rank",
          textContent: "#" + (i + 1),
        });
        const viewsEl = makeEl("div", {
          className: "views",
          textContent: formatCount(reel.views) + " views",
        });
        const ratioEl = makeEl("div", {
          className: "ratio",
          textContent: ratio + "\u00d7 follower count",
        });
        const info = makeEl("div", { className: "info" }, [viewsEl, ratioEl]);

        const openLink = makeEl("a", {
          className: "btn open",
          href: reel.url,
          target: "_blank",
          rel: "noopener",
          textContent: "Open",
        });

        const copyBtn = makeEl("button", {
          className: "btn copy",
          textContent: "Copy link",
        });
        (copyBtn as HTMLElement).dataset.url = reel.url;

        const actions = makeEl("div", { className: "actions" }, [
          openLink,
          copyBtn,
        ]);
        const item = makeEl("div", { className: "item" }, [
          rank,
          info,
          actions,
        ]);
        list.appendChild(item);
      });
    }

    const closeBtn = makeEl("button", {
      className: "close-btn",
      textContent: "Close & Reset",
    });
    closeBtn.addEventListener("click", function () {
      resetAll();
    });
    const footer = makeEl("div", { className: "footer" }, [closeBtn]);

    const panel = makeEl("div", { className: "panel" }, [
      header,
      list,
      footer,
    ]);
    shadow.appendChild(panel);

    shadow.addEventListener("click", function (e: Event) {
      const target = (e.target as Element)?.closest(".copy") as HTMLElement | null;
      if (!target) return;
      const url = target.dataset.url;
      if (!url) return;
      navigator.clipboard
        .writeText(url)
        .then(function () {
          target.textContent = "Copied!";
          setTimeout(function () {
            target.textContent = "Copy link";
          }, 1500);
        })
        .catch(function () {
          target.textContent = "Failed";
          setTimeout(function () {
            target.textContent = "Copy link";
          }, 1500);
        });
    });

    document.body.appendChild(host);
  }

  function removeOverlay(): void {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
  }

  // ── Hide / show tiles ──────────────────────────────────────────────────
  function injectHideStyle(): void {
    if (document.getElementById("reels5x-style")) return;
    const style = document.createElement("style");
    style.id = "reels5x-style";
    style.textContent = "." + HIDDEN_CLASS + " { display: none !important; }";
    document.head.appendChild(style);
  }

  function removeHideStyle(): void {
    const style = document.getElementById("reels5x-style");
    if (style) style.remove();
  }

  function unhideAll(): void {
    const nodes = document.querySelectorAll("." + HIDDEN_CLASS);
    for (let i = 0; i < nodes.length; i++) {
      nodes[i]!.classList.remove(HIDDEN_CLASS);
    }
  }

  function hideNonQualifyingTiles(): void {
    if (!_qualifyingHrefs) return;
    const links = document.querySelectorAll(
      'a[href*="/reel/"], a[href*="/reels/"]'
    );
    for (let i = 0; i < links.length; i++) {
      const href = links[i]!.getAttribute("href");
      if (!href) continue;
      const tile =
        links[i]!.closest("article") ??
        links[i]!.closest('[role="button"]') ??
        links[i]!.parentElement;
      if (!tile) continue;
      if (_qualifyingHrefs.has(href)) {
        tile.classList.remove(HIDDEN_CLASS);
      } else {
        tile.classList.add(HIDDEN_CLASS);
      }
    }
  }

  function startHideObserver(): void {
    stopHideObserver();
    let scheduled = false;
    _hideObserver = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        hideNonQualifyingTiles();
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
    _qualifyingHrefs = null;
    unhideAll();
    removeHideStyle();
    removeOverlay();
    window.__reels5x_active = false;
  }

  window.__reels5x_reset = resetAll;

  // ── Collect reels currently visible in the DOM into an accumulator map ─
  function collectVisibleReels(reelMap: Map<string, ReelData>): void {
    const links = document.querySelectorAll(
      'a[href*="/reel/"], a[href*="/reels/"]'
    );
    for (let li = 0; li < links.length; li++) {
      const link = links[li]!;
      const href = link.getAttribute("href");
      if (!href || reelMap.has(href)) continue;

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

    const reelMap = new Map<string, ReelData>();
    let previousMapSize = 0;
    let stableRounds = 0;
    let scrollAttempts = 0;

    showProgress("Scrolling to load all reels\u2026 (0 found)");

    function scrollStep(): void {
      try {
        if (myGen !== _runGeneration) return;

        collectVisibleReels(reelMap);
        const currentSize = reelMap.size;

        if (currentSize > previousMapSize) {
          stableRounds = 0;
          previousMapSize = currentSize;
          showProgress(
            "Scrolling to load all reels\u2026 (" + currentSize + " found)"
          );
        } else {
          stableRounds++;
        }

        scrollAttempts++;

        if (stableRounds >= 8 || scrollAttempts >= MAX_SCROLL_ATTEMPTS) {
          window.scrollTo(0, 0);
          setTimeout(function () {
            analyzeFromMap(reelMap);
          }, 500);
          return;
        }

        window.scrollTo(0, window.scrollY + SCROLL_STEP_PX);
        setTimeout(scrollStep, SCROLL_WAIT_MS);
      } catch (err) {
        console.error("[reels5x] Scroll loop error:", err);
        resetAll();
      }
    }

    scrollStep();
  }

  // ── Analysis using accumulated reel map ────────────────────────────────
  function analyzeFromMap(reelMap: Map<string, ReelData>): void {
    const followers = getFollowerCount();
    if (isNaN(followers) || followers <= 0) {
      resetAll();
      showError(
        "Can\u2019t read followers on this profile.\n\n" +
          "The follower count may not be visible on this page."
      );
      return;
    }

    const threshold = followers * MULTIPLIER;
    const allReels: ReelData[] = [];
    reelMap.forEach(function (reel) {
      allReels.push(reel);
    });
    const reelsWithViews = allReels.filter(function (r) {
      return !isNaN(r.views);
    });

    if (reelsWithViews.length === 0) {
      resetAll();
      showError(
        "Can\u2019t read views on this profile.\n\n" +
          "View counts may not be displayed on these Reel thumbnails."
      );
      return;
    }

    const qualifying = reelsWithViews
      .filter(function (r) {
        return r.views >= threshold;
      })
      .sort(function (a, b) {
        return b.views - a.views;
      }); // Views are guaranteed non-NaN after the reelsWithViews filter above.

    _qualifyingHrefs = new Set<string>();
    for (let i = 0; i < qualifying.length; i++) {
      _qualifyingHrefs.add(qualifying[i]!.href);
    }

    injectHideStyle();
    hideNonQualifyingTiles();
    startHideObserver();

    renderOverlay(followers, threshold, qualifying, allReels.length);
  }

  // ── Main entry ─────────────────────────────────────────────────────────
  function run(): void {
    if (!isReelsPage()) {
      const onProfile = /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/?$/.test(
        window.location.href
      );
      const msg = onProfile
        ? 'Please navigate to the Reels tab of this profile first.\n\nClick the "Reels" tab (film icon) on the profile, then try again.'
        : "Please open an Instagram profile\u2019s Reels tab first.\n\nExample: instagram.com/username/reels/";
      resetAll();
      showError(msg);
      return;
    }

    autoScrollAndRun();
  }

  run();
}

init();
