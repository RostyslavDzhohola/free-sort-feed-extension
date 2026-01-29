(function () {
  "use strict";

  // Prevent double-injection
  if (window.__reels5x_active) return;
  window.__reels5x_active = true;

  var _runGeneration = 0;

  // ── Constants ──────────────────────────────────────────────────────────
  var MULTIPLIER = 5;
  var HIDDEN_CLASS = "reels5x-hidden";
  var OVERLAY_ID = "reels5x-overlay";
  var SCROLL_STEP_PX = 600;
  var SCROLL_WAIT_MS = 800;
  var MAX_SCROLL_ATTEMPTS = 500; // safety cap

  // ── Number parsing ─────────────────────────────────────────────────────
  function parseCount(raw) {
    if (raw == null) return NaN;
    var s = String(raw).trim().replace(/[\s,\u00a0]+/g, "");
    var match = s.match(/^([\d.]+)\s*([KMBkmb])?$/);
    if (!match) return NaN;
    var num = parseFloat(match[1]);
    if (isNaN(num)) return NaN;
    var suffix = (match[2] || "").toUpperCase();
    if (suffix === "K") num *= 1000;
    else if (suffix === "M") num *= 1000000;
    else if (suffix === "B") num *= 1000000000;
    return Math.round(num);
  }

  function formatCount(n) {
    if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  // ── Page detection ─────────────────────────────────────────────────────
  function isReelsPage() {
    var url = window.location.href;
    if (/\/(explore|p|stories|direct)\//i.test(url)) return false;
    return /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/reels\/?(\?.*)?$/.test(url);
  }

  // ── SVG classification ─────────────────────────────────────────────────
  // Distinguish play (triangle) icons from heart (like) icons
  function isHeartSvg(svg) {
    // Check aria-label on svg or parent
    var label = (svg.getAttribute("aria-label") || "").toLowerCase();
    if (/like|heart|unlik/.test(label)) return true;
    var parentLabel = svg.parentElement
      ? (svg.parentElement.getAttribute("aria-label") || "").toLowerCase()
      : "";
    if (/like|heart|unlik/.test(parentLabel)) return true;

    // Check SVG path data — hearts have curved paths (C/c/Q/q commands)
    var paths = svg.querySelectorAll("path");
    for (var i = 0; i < paths.length; i++) {
      var d = paths[i].getAttribute("d") || "";
      // Heart paths typically have many curve commands
      var curveCount = (d.match(/[CcQqSs]/g) || []).length;
      if (curveCount >= 4) return true;
    }
    return false;
  }

  function isPlaySvg(svg) {
    var label = (svg.getAttribute("aria-label") || "").toLowerCase();
    if (/play|view|video|watch|reel/.test(label)) return true;
    var parentLabel = svg.parentElement
      ? (svg.parentElement.getAttribute("aria-label") || "").toLowerCase()
      : "";
    if (/play|view|video|watch|reel/.test(parentLabel)) return true;

    // Play icons are typically simple triangles (polygon) or short paths
    var polys = svg.querySelectorAll("polygon");
    if (polys.length > 0) return true;
    var paths = svg.querySelectorAll("path");
    for (var i = 0; i < paths.length; i++) {
      var d = paths[i].getAttribute("d") || "";
      // Play triangles have very few curve commands
      var curveCount = (d.match(/[CcQqSs]/g) || []).length;
      if (curveCount <= 1 && d.length < 80) return true;
    }
    return false;
  }

  // ── Extract number near an SVG element ─────────────────────────────────
  function getNumberNearSvg(svg) {
    var container = svg.parentElement;
    if (!container) return NaN;
    // Look at siblings and parent text
    var text = container.textContent.trim();
    var m = text.match(/([\d,.]+[KMBkmb]?)/);
    if (m) return parseCount(m[1]);
    // Also check the grandparent
    var grandparent = container.parentElement;
    if (grandparent) {
      text = grandparent.textContent.trim();
      m = text.match(/([\d,.]+[KMBkmb]?)/);
      if (m) return parseCount(m[1]);
    }
    return NaN;
  }

  // ── Follower extraction ────────────────────────────────────────────────
  function getFollowerCount() {
    // Strategy 1 (primary): DOM — followers link contains the exact count
    // The number lives at: a[href*="/followers"] > span > span > span
    // For large accounts, the <a> tag may also have a title="1,234,567" attribute.
    var followerLinks = document.querySelectorAll('a[href*="/followers"]');
    for (var i = 0; i < followerLinks.length; i++) {
      var link = followerLinks[i];

      // First check title attribute (exact number for large accounts)
      var title = link.getAttribute("title");
      if (title) {
        var c = parseCount(title.replace(/,/g, ""));
        if (!isNaN(c) && c > 0) return c;
      }

      // Then look for the innermost span with a pure number
      var innerSpans = link.querySelectorAll("span");
      for (var s = innerSpans.length - 1; s >= 0; s--) {
        var spanText = innerSpans[s].textContent.trim();
        if (/^[\d,.]+[KMBkmb]?$/.test(spanText)) {
          var parsed = parseCount(spanText);
          if (!isNaN(parsed) && parsed > 0) return parsed;
        }
      }

      // Fallback: full link textContent
      var text = link.textContent.trim();
      var m2 = text.match(/([\d,.]+[KMBkmb]?)/);
      if (m2) {
        var c2 = parseCount(m2[1]);
        if (!isNaN(c2) && c2 > 0) return c2;
      }
    }

    // Strategy 2 (fallback): header text containing "followers"
    var headerSection = document.querySelector("header section");
    if (headerSection) {
      var hSpans = headerSection.querySelectorAll("span");
      for (var j = 0; j < hSpans.length; j++) {
        var parent = hSpans[j].parentElement;
        if (parent && /followers/i.test(parent.textContent)) {
          var hText = hSpans[j].textContent.trim();
          if (/^[\d,.]+[KMBkmb]?$/.test(hText)) {
            var c3 = parseCount(hText);
            if (!isNaN(c3) && c3 > 0) return c3;
          }
        }
      }
    }

    // Strategy 3 (last resort): meta og:description — can be stale/rounded
    var meta = document.querySelector('meta[property="og:description"]');
    if (meta) {
      var content = meta.getAttribute("content") || "";
      var m = content.match(/([\d,.]+[KMBkmb]?)\s+Followers/i);
      if (m) {
        var count = parseCount(m[1]);
        if (!isNaN(count) && count > 0) return count;
      }
    }

    return NaN;
  }

  // ── DOM helper ─────────────────────────────────────────────────────────
  function makeEl(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i], val = attrs[key];
        if (key === "textContent") node.textContent = val;
        else if (key === "className") node.className = val;
        else if (key === "style" && typeof val === "string") node.style.cssText = val;
        else node.setAttribute(key, val);
      }
    }
    if (children) {
      for (var j = 0; j < children.length; j++) {
        var child = children[j];
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
      }
    }
    return node;
  }

  // ── Progress overlay (shown during scroll phase) ───────────────────────
  function showProgress(message) {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    var host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.style.cssText =
      "position:fixed;top:80px;right:16px;z-index:999999;width:320px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

    var shadow = host.attachShadow({ mode: "open" });
    var styleEl = document.createElement("style");
    styleEl.textContent = [
      ":host { all: initial; }",
      ".box { background:#fff; border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,0.18); padding:16px; }",
      ".title { font-size:14px; font-weight:700; color:#262626; margin-bottom:8px; }",
      ".msg { font-size:13px; color:#8e8e8e; }",
      ".spinner { display:inline-block; width:14px; height:14px; border:2px solid #dbdbdb; border-top-color:#0095f6; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle; }",
      "@keyframes spin { to { transform:rotate(360deg); } }",
    ].join("\n");
    shadow.appendChild(styleEl);

    var box = makeEl("div", { className: "box" }, [
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
  function renderOverlay(followers, threshold, qualifying, totalScanned) {
    removeOverlay();

    var host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.style.cssText =
      "position:fixed;top:80px;right:16px;z-index:999999;width:360px;max-height:80vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

    var shadow = host.attachShadow({ mode: "open" });

    var styleEl = document.createElement("style");
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

    var outlierText = qualifying.length + " outlier" + (qualifying.length !== 1 ? "s" : "") + " found";
    var scannedText = "(scanned " + totalScanned + " reels)";

    var headerH2 = makeEl("h2", { textContent: "Reels 5\u00d7 Outliers" });
    var metaDiv = makeEl("div", { className: "meta" }, [
      "Followers: " + formatCount(followers) + " \u00b7 Threshold: " + formatCount(threshold) + " views",
      document.createElement("br"),
      outlierText + " " + scannedText,
    ]);
    var header = makeEl("div", { className: "header" }, [headerH2, metaDiv]);

    var list = makeEl("div", { className: "list" });

    if (qualifying.length === 0) {
      list.appendChild(
        makeEl("div", { className: "empty", textContent: "No Reels reached the 5\u00d7 threshold." })
      );
    } else {
      qualifying.forEach(function (reel, i) {
        var ratio = (reel.views / followers).toFixed(1);
        var rank = makeEl("span", { className: "rank", textContent: "#" + (i + 1) });
        var viewsEl = makeEl("div", { className: "views", textContent: formatCount(reel.views) + " views" });
        var ratioEl = makeEl("div", { className: "ratio", textContent: ratio + "\u00d7 follower count" });
        var info = makeEl("div", { className: "info" }, [viewsEl, ratioEl]);

        var openLink = makeEl("a", {
          className: "btn open",
          href: reel.url,
          target: "_blank",
          rel: "noopener",
          textContent: "Open",
        });

        var copyBtn = makeEl("button", { className: "btn copy", textContent: "Copy link" });
        copyBtn.dataset.url = reel.url;

        var actions = makeEl("div", { className: "actions" }, [openLink, copyBtn]);
        var item = makeEl("div", { className: "item" }, [rank, info, actions]);
        list.appendChild(item);
      });
    }

    var closeBtn = makeEl("button", { className: "close-btn", textContent: "Close & Reset" });
    closeBtn.addEventListener("click", function () { resetAll(); });
    var footer = makeEl("div", { className: "footer" }, [closeBtn]);

    var panel = makeEl("div", { className: "panel" }, [header, list, footer]);
    shadow.appendChild(panel);

    shadow.addEventListener("click", function (e) {
      var target = e.target.closest(".copy");
      if (!target) return;
      var url = target.dataset.url;
      if (!url) return;
      navigator.clipboard.writeText(url).then(function () {
        target.textContent = "Copied!";
        setTimeout(function () { target.textContent = "Copy link"; }, 1500);
      }).catch(function () {
        target.textContent = "Failed";
        setTimeout(function () { target.textContent = "Copy link"; }, 1500);
      });
    });

    document.body.appendChild(host);
  }

  function removeOverlay() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
  }

  // ── Hide / show tiles ──────────────────────────────────────────────────
  var _hideObserver = null; // MutationObserver for persistent hiding
  var _qualifyingHrefs = null; // Set of reel hrefs that pass the threshold

  function injectHideStyle() {
    if (document.getElementById("reels5x-style")) return;
    var style = document.createElement("style");
    style.id = "reels5x-style";
    style.textContent = "." + HIDDEN_CLASS + " { display: none !important; }";
    document.head.appendChild(style);
  }

  function removeHideStyle() {
    var style = document.getElementById("reels5x-style");
    if (style) style.remove();
  }

  function unhideAll() {
    var nodes = document.querySelectorAll("." + HIDDEN_CLASS);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove(HIDDEN_CLASS);
    }
  }

  // Hide reel tiles currently in the DOM that are NOT in the qualifying set
  function hideNonQualifyingTiles() {
    if (!_qualifyingHrefs) return;
    var links = document.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      if (!href) continue;
      var tile = links[i].closest("article") || links[i].closest('[role="button"]') || links[i].parentElement;
      if (_qualifyingHrefs.has(href)) {
        tile.classList.remove(HIDDEN_CLASS);
      } else {
        tile.classList.add(HIDDEN_CLASS);
      }
    }
  }

  // Watch for Instagram adding new tiles and hide them if needed
  function startHideObserver() {
    stopHideObserver();
    var scheduled = false;
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

  function stopHideObserver() {
    if (_hideObserver) {
      _hideObserver.disconnect();
      _hideObserver = null;
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────
  function resetAll() {
    stopHideObserver();
    _qualifyingHrefs = null;
    unhideAll();
    removeHideStyle();
    removeOverlay();
    window.__reels5x_active = false;
  }

  window.__reels5x_reset = resetAll;

  // ── Collect reels currently visible in the DOM into an accumulator map ─
  function collectVisibleReels(reelMap) {
    var links = document.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]');
    for (var li = 0; li < links.length; li++) {
      var link = links[li];
      var href = link.getAttribute("href");
      if (!href || reelMap.has(href)) continue;

      var fullUrl = href.startsWith("http")
        ? href
        : "https://www.instagram.com" + href;

      var views = NaN;

      // Priority 1: aria-labels
      var ariaEls = link.querySelectorAll("[aria-label]");
      for (var a = 0; a < ariaEls.length; a++) {
        var label = ariaEls[a].getAttribute("aria-label") || "";
        var m = label.match(/([\d,.]+[KMBkmb]?)\s*(views|plays|play)/i);
        if (m) {
          views = parseCount(m[1]);
          if (!isNaN(views)) break;
        }
      }
      if (isNaN(views)) {
        var linkAria = link.getAttribute("aria-label") || "";
        var lm = linkAria.match(/([\d,.]+[KMBkmb]?)\s*(views|plays|play)/i);
        if (lm) views = parseCount(lm[1]);
      }

      // Priority 2: SVG play icon
      if (isNaN(views)) {
        var svgs = link.querySelectorAll("svg");
        for (var s = 0; s < svgs.length; s++) {
          if (isPlaySvg(svgs[s]) && !isHeartSvg(svgs[s])) {
            var num = getNumberNearSvg(svgs[s]);
            if (!isNaN(num) && num > 0) { views = num; break; }
          }
        }
      }

      // Priority 3: non-heart SVG number
      if (isNaN(views)) {
        var svgs2 = link.querySelectorAll("svg");
        var candidates = [];
        for (var s2 = 0; s2 < svgs2.length; s2++) {
          var n = getNumberNearSvg(svgs2[s2]);
          if (!isNaN(n) && n > 0) {
            candidates.push({ value: n, isHeart: isHeartSvg(svgs2[s2]) });
          }
        }
        for (var c = 0; c < candidates.length; c++) {
          if (!candidates[c].isHeart) { views = candidates[c].value; break; }
        }
        if (isNaN(views) && candidates.length >= 2) {
          views = candidates[0].value;
        }
      }

      // Priority 4: span numbers
      if (isNaN(views)) {
        var allSpans = link.querySelectorAll("span");
        var numbers = [];
        for (var sp = 0; sp < allSpans.length; sp++) {
          var txt = allSpans[sp].textContent.trim();
          if (/^[\d,.]+[KMBkmb]?$/.test(txt)) {
            var parsed = parseCount(txt);
            if (!isNaN(parsed) && parsed > 0) numbers.push(parsed);
          }
        }
        if (numbers.length === 1) {
          views = numbers[0];
        } else if (numbers.length >= 2) {
          numbers.sort(function (a, b) { return b - a; });
          views = numbers[0];
        }
      }

      reelMap.set(href, { url: fullUrl, href: href, views: views });
    }
  }

  // ── Auto-scroll to load all reels ──────────────────────────────────────
  function autoScrollAndRun() {
    _runGeneration++;
    var myGen = _runGeneration;

    // Accumulate reels across all scroll positions (survives virtual DOM recycling)
    var reelMap = new Map();
    var previousMapSize = 0;
    var stableRounds = 0;
    var scrollAttempts = 0;

    showProgress("Scrolling to load all reels\u2026 (0 found)");

    function scrollStep() {
      try {
        if (myGen !== _runGeneration) return;

        // Collect any reels currently in the DOM
        collectVisibleReels(reelMap);
        var currentSize = reelMap.size;

        if (currentSize > previousMapSize) {
          stableRounds = 0;
          previousMapSize = currentSize;
          showProgress("Scrolling to load all reels\u2026 (" + currentSize + " found)");
        } else {
          stableRounds++;
        }

        scrollAttempts++;

        // Stop if: no new reels after 8 consecutive scrolls, or hit safety cap
        if (stableRounds >= 8 || scrollAttempts >= MAX_SCROLL_ATTEMPTS) {
          window.scrollTo(0, 0);
          setTimeout(function () { analyzeFromMap(reelMap); }, 500);
          return;
        }

        // Scroll down incrementally — must pass through each position to capture
        // tiles before Instagram's virtual DOM recycles them
        window.scrollTo(0, window.scrollY + SCROLL_STEP_PX);
        setTimeout(scrollStep, SCROLL_WAIT_MS);
      } catch (err) {
        resetAll();
      }
    }

    scrollStep();
  }

  // ── Analysis using accumulated reel map ────────────────────────────────
  function analyzeFromMap(reelMap) {
    var followers = getFollowerCount();
    if (isNaN(followers) || followers <= 0) {
      resetAll();
      alert(
        "Reels 5\u00d7 Filter: Can\u2019t read followers on this profile.\n\n" +
          "The follower count may not be visible on this page."
      );
      return;
    }

    var threshold = followers * MULTIPLIER;
    var allReels = [];
    reelMap.forEach(function (reel) { allReels.push(reel); });
    var reelsWithViews = allReels.filter(function (r) { return !isNaN(r.views); });

    if (reelsWithViews.length === 0) {
      resetAll();
      alert(
        "Reels 5\u00d7 Filter: Can\u2019t read views on this profile.\n\n" +
          "View counts may not be displayed on these Reel thumbnails."
      );
      return;
    }

    var qualifying = reelsWithViews
      .filter(function (r) { return r.views >= threshold; })
      .sort(function (a, b) { return b.views - a.views; });

    // Build the set of qualifying hrefs for persistent hiding
    _qualifyingHrefs = new Set();
    for (var i = 0; i < qualifying.length; i++) {
      _qualifyingHrefs.add(qualifying[i].href);
    }

    // Hide non-qualifying tiles currently in the DOM
    injectHideStyle();
    hideNonQualifyingTiles();

    // Watch for Instagram adding new tiles (virtual scroll) and hide them too
    startHideObserver();

    renderOverlay(followers, threshold, qualifying, allReels.length);
  }

  // ── Main entry ─────────────────────────────────────────────────────────
  function run() {
    if (!isReelsPage()) {
      var onProfile = /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/?$/.test(
        window.location.href
      );
      var msg = onProfile
        ? "Reels 5\u00d7 Filter: Please navigate to the Reels tab of this profile first.\n\nClick the \"Reels\" tab (film icon) on the profile, then try again."
        : "Reels 5\u00d7 Filter: Please open an Instagram profile\u2019s Reels tab first.\n\nExample: instagram.com/username/reels/";
      alert(msg);
      resetAll();
      return;
    }

    // Start scrolling to load all reels, then analyze
    autoScrollAndRun();
  }

  run();
})();
