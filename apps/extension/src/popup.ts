const btn = document.getElementById("run-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const statsArea = document.getElementById("stats-area") as HTMLDivElement;
let isActive = false;
let cachedTabId: number | null = null;

function formatExact(n: number): string {
  return n.toLocaleString("en-US");
}

// ── Show stats in popup ────────────────────────────────────────────────
function showStats(followers: number, threshold: number): void {
  statsArea.textContent = "";
  const box = document.createElement("div");
  box.className = "stats";

  const row1 = document.createElement("div");
  row1.className = "stat-row";
  const label1 = document.createElement("span");
  label1.className = "stat-label";
  label1.textContent = "Followers";
  const val1 = document.createElement("span");
  val1.className = "stat-value followers";
  val1.textContent = formatExact(followers);
  row1.appendChild(label1);
  row1.appendChild(val1);

  const divider = document.createElement("div");
  divider.className = "divider";

  const row2 = document.createElement("div");
  row2.className = "stat-row";
  const label2 = document.createElement("span");
  label2.className = "stat-label";
  label2.textContent = "5\u00d7 threshold";
  const val2 = document.createElement("span");
  val2.className = "stat-value threshold";
  val2.textContent = formatExact(threshold) + " views";
  row2.appendChild(label2);
  row2.appendChild(val2);

  box.appendChild(row1);
  box.appendChild(divider);
  box.appendChild(row2);
  statsArea.appendChild(box);
}

function showError(msg: string): void {
  statsArea.textContent = "";
  const el = document.createElement("div");
  el.className = "error-msg";
  el.textContent = msg;
  statsArea.appendChild(el);
}

// ── The function injected into the page to read followers ──────────────
// IMPORTANT: This function is injected via chrome.scripting.executeScript({ func }).
// It must be entirely self-contained — no imports, no closures, no external references.
// The inline parseCount() intentionally duplicates src/shared/parse-count.ts.
function readFollowersFromPage(): number | null {
  function parseCount(raw: unknown): number {
    if (raw == null) return NaN;
    const s = String(raw).trim().replace(/[\s,\u00a0]+/g, "");
    const match = s.match(/^([\d.]+)\s*([KMBkmb])?$/);
    if (!match) return NaN;
    let num = parseFloat(match[1]!);
    if (isNaN(num)) return NaN;
    const suffix = (match[2] ?? "").toUpperCase();
    if (suffix === "K") num *= 1000;
    else if (suffix === "M") num *= 1000000;
    else if (suffix === "B") num *= 1000000000;
    return Math.round(num);
  }

  // Strategy 1: DOM followers link
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

  // Strategy 2: header section
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

  // Strategy 3: meta tag
  const meta = document.querySelector('meta[property="og:description"]');
  if (meta) {
    const content = meta.getAttribute("content") ?? "";
    const m = content.match(/([\d,.]+[KMBkmb]?)\s+Followers/i);
    if (m) {
      const count = parseCount(m[1]);
      if (!isNaN(count) && count > 0) return count;
    }
  }

  return null;
}

// ── On popup open: immediately read profile data ───────────────────────
async function init(): Promise<void> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_err) {
    showError("Cannot access browser tabs.");
    return;
  }

  const tab = tabs[0];
  if (!tab?.url?.includes("instagram.com")) {
    showError("Open an Instagram profile page first.");
    return;
  }
  cachedTabId = tab.id ?? null;

  if (cachedTabId != null) {
    try {
      const activeResult = await chrome.scripting.executeScript({
        target: { tabId: cachedTabId },
        func: function () {
          return !!window.__outliers_active;
        },
      });
      if (activeResult?.[0]?.result) {
        isActive = true;
        btn.textContent = "Reset";
        btn.classList.add("reset");
        btn.disabled = false;
      }
    } catch (_) {
      /* tab may not allow scripting — non-fatal */
    }

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: cachedTabId },
        func: readFollowersFromPage,
      });
      const followers = result?.[0]?.result ?? null;
      if (followers && followers > 0) {
        showStats(followers, followers * 5);
        btn.disabled = false;
      } else {
        showError("Can\u2019t read follower count on this page.");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "unknown error";
      showError("Cannot read page data: " + message);
    }
  } else {
    showError("Cannot access this tab.");
  }
}

// ── Button click handler ───────────────────────────────────────────────
btn.addEventListener("click", async function () {
  btn.disabled = true;
  statusEl.textContent = "";
  statusEl.className = "";

  try {
    let tabId = cachedTabId;
    if (!tabId) {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      tabId = tabs[0]?.id ?? null;
    }

    if (!tabId) {
      statusEl.textContent = "No active tab found.";
      statusEl.className = "error";
      return;
    }

    if (isActive) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function () {
            if (typeof window.__outliers_reset === "function") {
              window.__outliers_reset();
            }
          },
        });
      } catch (_) {
        /* tab may be closed — still reset local state */
      }
      isActive = false;
      btn.textContent = "Run Outliers Scan";
      btn.classList.remove("reset");
      statusEl.textContent = "Filter removed.";
    } else {
      statusEl.textContent = "Scanning\u2026";
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["injected.js"],
      });
      isActive = true;
      btn.textContent = "Reset";
      btn.classList.add("reset");
      statusEl.textContent = "Filter active \u2014 check the page.";
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Something went wrong.";
    statusEl.textContent = message;
    statusEl.className = "error";
  } finally {
    btn.disabled = false;
  }
});

init();
