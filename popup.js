(function () {
  var btn = document.getElementById("run-btn");
  var status = document.getElementById("status");
  var statsArea = document.getElementById("stats-area");
  var isActive = false;
  var cachedTabId = null;

  function formatExact(n) {
    return n.toLocaleString("en-US");
  }

  // ── Show stats in popup ────────────────────────────────────────────────
  function showStats(followers, threshold) {
    statsArea.textContent = "";
    var box = document.createElement("div");
    box.className = "stats";

    var row1 = document.createElement("div");
    row1.className = "stat-row";
    var label1 = document.createElement("span");
    label1.className = "stat-label";
    label1.textContent = "Followers";
    var val1 = document.createElement("span");
    val1.className = "stat-value followers";
    val1.textContent = formatExact(followers);
    row1.appendChild(label1);
    row1.appendChild(val1);

    var divider = document.createElement("div");
    divider.className = "divider";

    var row2 = document.createElement("div");
    row2.className = "stat-row";
    var label2 = document.createElement("span");
    label2.className = "stat-label";
    label2.textContent = "5\u00d7 threshold";
    var val2 = document.createElement("span");
    val2.className = "stat-value threshold";
    val2.textContent = formatExact(threshold) + " views";
    row2.appendChild(label2);
    row2.appendChild(val2);

    box.appendChild(row1);
    box.appendChild(divider);
    box.appendChild(row2);
    statsArea.appendChild(box);
  }

  function showError(msg) {
    statsArea.textContent = "";
    var el = document.createElement("div");
    el.className = "error-msg";
    el.textContent = msg;
    statsArea.appendChild(el);
  }

  // ── The function injected into the page to read followers ──────────────
  // This must be self-contained (no closures over popup variables).
  function readFollowersFromPage() {
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

    // Strategy 1: DOM followers link
    var followerLinks = document.querySelectorAll('a[href*="/followers"]');
    for (var i = 0; i < followerLinks.length; i++) {
      var link = followerLinks[i];
      var title = link.getAttribute("title");
      if (title) {
        var c = parseCount(title.replace(/,/g, ""));
        if (!isNaN(c) && c > 0) return c;
      }
      var innerSpans = link.querySelectorAll("span");
      for (var s = innerSpans.length - 1; s >= 0; s--) {
        var spanText = innerSpans[s].textContent.trim();
        if (/^[\d,.]+[KMBkmb]?$/.test(spanText)) {
          var parsed = parseCount(spanText);
          if (!isNaN(parsed) && parsed > 0) return parsed;
        }
      }
      var text = link.textContent.trim();
      var m2 = text.match(/([\d,.]+[KMBkmb]?)/);
      if (m2) {
        var c2 = parseCount(m2[1]);
        if (!isNaN(c2) && c2 > 0) return c2;
      }
    }

    // Strategy 2: header section
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

    // Strategy 3: meta tag
    var meta = document.querySelector('meta[property="og:description"]');
    if (meta) {
      var content = meta.getAttribute("content") || "";
      var m = content.match(/([\d,.]+[KMBkmb]?)\s+Followers/i);
      if (m) {
        var count = parseCount(m[1]);
        if (!isNaN(count) && count > 0) return count;
      }
    }

    return null;
  }

  // ── On popup open: immediately read profile data ───────────────────────
  async function init() {
    var tabs, tab;
    try {
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs[0];
    } catch (err) {
      showError("Cannot access browser tabs.");
      return;
    }

    if (!tab || !tab.url || !tab.url.includes("instagram.com")) {
      showError("Open an Instagram profile page first.");
      return;
    }
    cachedTabId = tab.id;

    try {
      var activeResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function () { return !!window.__reels5x_active; },
      });
      if (activeResult && activeResult[0] && activeResult[0].result) {
        isActive = true;
        btn.textContent = "Reset";
        btn.classList.add("reset");
        btn.disabled = false;
      }
    } catch (_) { /* tab may not allow scripting — non-fatal */ }

    try {
      var result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readFollowersFromPage,
      });
      var followers = result && result[0] ? result[0].result : null;
      if (followers && followers > 0) {
        showStats(followers, followers * 5);
        btn.disabled = false;
      } else {
        showError("Can\u2019t read follower count on this page.");
      }
    } catch (err) {
      showError("Cannot read page data: " + (err.message || "unknown error"));
    }
  }

  // ── Button click handler ───────────────────────────────────────────────
  btn.addEventListener("click", async function () {
    btn.disabled = true;
    status.textContent = "";
    status.className = "";

    try {
      var tabId = cachedTabId;
      if (!tabId) {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tabs[0] ? tabs[0].id : null;
      }

      if (!tabId) {
        status.textContent = "No active tab found.";
        status.className = "error";
        return;
      }

      if (isActive) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function () {
              if (typeof window.__reels5x_reset === "function") {
                window.__reels5x_reset();
              }
            },
          });
        } catch (_) { /* tab may be closed — still reset local state */ }
        isActive = false;
        btn.textContent = "Run 5\u00d7 Filter";
        btn.classList.remove("reset");
        status.textContent = "Filter removed.";
      } else {
        status.textContent = "Scanning\u2026";
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["injected.js"],
        });
        isActive = true;
        btn.textContent = "Reset";
        btn.classList.add("reset");
        status.textContent = "Filter active \u2014 check the page.";
      }
    } catch (err) {
      status.textContent = err.message || "Something went wrong.";
      status.className = "error";
    } finally {
      btn.disabled = false;
    }
  });

  init();
})();
