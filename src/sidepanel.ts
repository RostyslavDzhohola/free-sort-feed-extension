import { startHotReload } from "./hot-reload";
import type { OutliersState, OutliersMessage, OutliersEntry } from "./types/state";

declare const __OUTLIERS_WATCH__: boolean;

if (__OUTLIERS_WATCH__) {
  startHotReload();
}

// ── DOM refs ──────────────────────────────────────────────────────────────
const statsArea = document.getElementById("stats-area") as HTMLDivElement;
const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const progressArea = document.getElementById("progress-area") as HTMLDivElement;
const progressFill = document.getElementById("progress-fill") as HTMLDivElement;
const progressText = document.getElementById("progress-text") as HTMLDivElement;
const resultsArea = document.getElementById("results-area") as HTMLDivElement;
const resultsMeta = document.getElementById("results-meta") as HTMLSpanElement;
const resultsList = document.getElementById("results-list") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const scanLimitInput = document.getElementById("scan-limit-input") as HTMLInputElement;
const presetBtns = document.querySelectorAll(".preset-btn") as NodeListOf<HTMLButtonElement>;

let cachedTabId: number | null = null;
let lastKnownUrl: string | null = null;
let lastKnownProfile: string | null = null;
let navPollTimer: number | null = null;
let navPollInFlight = false;

// ── Formatting helpers ────────────────────────────────────────────────────
function formatExact(n: number): string {
  return n.toLocaleString("en-US");
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

// ── DOM helpers ───────────────────────────────────────────────────────────
function clearElement(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ── Scan limit helpers ────────────────────────────────────────────────────
const SCAN_LIMIT_KEY = "outliers_scan_limit";

function loadScanLimit(): number | null {
  try {
    const raw = localStorage.getItem(SCAN_LIMIT_KEY);
    if (!raw) return null;
    const val = parseInt(raw, 10);
    if (!Number.isFinite(val) || val <= 0) return null;
    return val;
  } catch {
    return null;
  }
}

function saveScanLimit(limit: number | null): void {
  try {
    if (limit === null) {
      localStorage.removeItem(SCAN_LIMIT_KEY);
    } else {
      localStorage.setItem(SCAN_LIMIT_KEY, String(limit));
    }
  } catch {
    // Non-fatal — defaults to unlimited
  }
}

function syncScanLimitUI(limit: number | null): void {
  if (limit === null) {
    scanLimitInput.value = "";
    scanLimitInput.placeholder = "Custom limit\u2026";
  } else {
    scanLimitInput.value = String(limit);
  }
  for (let i = 0; i < presetBtns.length; i++) {
    const btn = presetBtns[i]!;
    const btnLimit = btn.getAttribute("data-limit");
    if (limit === null && btnLimit === "all") {
      btn.classList.add("active");
    } else if (btnLimit !== "all" && limit === Number(btnLimit)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  }
}

function getScanLimitFromUI(): number | null {
  const raw = parseInt(scanLimitInput.value, 10);
  if (isNaN(raw) || raw <= 0) return null;
  return raw;
}

function setScanLimitControlsDisabled(disabled: boolean): void {
  scanLimitInput.disabled = disabled;
  for (let i = 0; i < presetBtns.length; i++) {
    presetBtns[i]!.disabled = disabled;
  }
}

// ── URL helpers ──────────────────────────────────────────────────────────
/** Extract the Instagram username from a URL, e.g. "/username" from any profile sub-page. */
function getProfilePath(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/instagram\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    // First segment is the username (skip system routes)
    if (parts.length === 0) return null;
    const reserved = ["explore", "p", "stories", "direct", "accounts", "reel", "reels"];
    if (reserved.includes(parts[0]!.toLowerCase())) return null;
    return "/" + parts[0]!.toLowerCase();
  } catch {
    return null;
  }
}

/** Check if a URL is a content permalink (/reel/XXX/, /p/XXX/) as opposed to a section page. */
function isContentPermalink(url: string): boolean {
  try {
    const u = new URL(url);
    return /^\/(reel|reels|p)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

// ── UI rendering ──────────────────────────────────────────────────────────
function showStats(followers: number, threshold: number): void {
  clearElement(statsArea);
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
  clearElement(statsArea);
  const el = document.createElement("div");
  el.className = "status-msg error";
  el.textContent = msg;
  statsArea.appendChild(el);
}

function showLoading(): void {
  clearElement(statsArea);
  const wrapper = document.createElement("div");
  wrapper.className = "status-msg";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  wrapper.appendChild(spinner);
  wrapper.appendChild(document.createTextNode("Reading profile\u2026"));
  statsArea.appendChild(wrapper);
}

function setProgress(scannedCount: number, scanLimit: number | null): void {
  progressArea.style.display = "block";
  if (scanLimit !== null && scanLimit > 0) {
    const pct = Math.min(100, (scannedCount / scanLimit) * 100);
    progressFill.style.width = pct + "%";
    progressFill.style.opacity = "1";
    progressFill.style.animation = "";
    progressText.textContent = "Scanning\u2026 " + scannedCount + " / " + scanLimit + " reels";
  } else {
    progressFill.style.width = "100%";
    progressFill.style.opacity = "0.4";
    progressFill.style.animation = "pulse 1.5s ease-in-out infinite";
    progressText.textContent = "Scanning\u2026 " + scannedCount + " reels found";
  }
}

function hideProgress(): void {
  progressArea.style.display = "none";
  progressFill.style.width = "0%";
  progressFill.style.opacity = "1";
  progressFill.style.animation = "";
}

function renderResults(outliers: OutliersEntry[], scannedCount: number, _followers: number): void {
  resultsArea.style.display = "block";
  resultsMeta.textContent = "\u2014 " + outliers.length + " of " + scannedCount + " reels";
  clearElement(resultsList);

  if (outliers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-msg";
    empty.textContent = "No Reels reached the 5\u00d7 threshold.";
    resultsList.appendChild(empty);
    return;
  }

  for (let i = 0; i < outliers.length; i++) {
    const reel = outliers[i]!;
    const item = document.createElement("div");
    item.className = "result-item";

    const rank = document.createElement("span");
    rank.className = "result-rank";
    rank.textContent = "#" + (i + 1);

    const info = document.createElement("div");
    info.className = "result-info";
    const views = document.createElement("div");
    views.className = "result-views";
    views.textContent = formatCount(reel.views) + " views";
    const ratio = document.createElement("div");
    ratio.className = "result-ratio";
    ratio.textContent = reel.ratio.toFixed(1) + "\u00d7 follower count";
    info.appendChild(views);
    info.appendChild(ratio);

    const actions = document.createElement("div");
    actions.className = "result-actions";
    const openLink = document.createElement("a");
    openLink.className = "btn-sm open";
    openLink.href = reel.url;
    openLink.target = "_blank";
    openLink.rel = "noopener";
    openLink.textContent = "Open";
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-sm";
    copyBtn.textContent = "Copy link";
    copyBtn.addEventListener("click", function () {
      navigator.clipboard
        .writeText(reel.url)
        .then(function () {
          copyBtn.textContent = "Copied!";
          setTimeout(function () { copyBtn.textContent = "Copy link"; }, 1500);
        })
        .catch(function () {
          copyBtn.textContent = "Failed";
          setTimeout(function () { copyBtn.textContent = "Copy link"; }, 1500);
        });
    });
    actions.appendChild(openLink);
    actions.appendChild(copyBtn);

    item.appendChild(rank);
    item.appendChild(info);
    item.appendChild(actions);
    resultsList.appendChild(item);
  }
}

function hideResults(): void {
  resultsArea.style.display = "none";
  clearElement(resultsList);
}

function setButtonsForIdle(): void {
  runBtn.style.display = "block";
  runBtn.disabled = false;
  stopBtn.style.display = "none";
  resetBtn.style.display = "none";
  setScanLimitControlsDisabled(false);
}

function setButtonsForScanning(): void {
  runBtn.style.display = "none";
  stopBtn.style.display = "block";
  stopBtn.disabled = false;
  resetBtn.style.display = "none";
  setScanLimitControlsDisabled(true);
}

function setButtonsForDone(): void {
  runBtn.style.display = "none";
  stopBtn.style.display = "none";
  resetBtn.style.display = "block";
  resetBtn.disabled = false;
  setScanLimitControlsDisabled(false);
}

function setButtonsDisabled(): void {
  runBtn.disabled = true;
  stopBtn.disabled = true;
  resetBtn.disabled = true;
}

// ── Render full state ─────────────────────────────────────────────────────
function renderState(state: OutliersState): void {
  statusEl.textContent = "";
  statusEl.className = "status-msg";

  if (state.followers && state.threshold) {
    showStats(state.followers, state.threshold);
  }

  switch (state.status) {
    case "idle":
      hideProgress();
      hideResults();
      setButtonsForIdle();
      break;
    case "scanning":
      setProgress(state.scannedCount, state.scanLimit);
      hideResults();
      setButtonsForScanning();
      break;
    case "done":
      hideProgress();
      if (state.followers) {
        renderResults(state.outliers, state.scannedCount, state.followers);
      }
      setButtonsForDone();
      break;
    case "error":
      hideProgress();
      hideResults();
      if (state.errorText) {
        statusEl.textContent = state.errorText;
        statusEl.className = "status-msg error";
      }
      setButtonsForIdle();
      break;
  }
}

// ── Read followers from page (self-contained, injected via executeScript) ─
// IMPORTANT: This function is injected via chrome.scripting.executeScript({ func }).
// It must be entirely self-contained — no imports, no closures, no external references.
function readFollowersFromPage(): number | null {
  // Only read followers on actual profile pages (instagram.com/<username>/ or /<username>/reels/)
  const path = window.location.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null; // Home feed — no profile
  const reserved = ["explore", "p", "stories", "direct", "accounts", "reel", "reels"];
  if (reserved.includes(segments[0]!.toLowerCase())) return null;

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

  return null;
}

// ── Tab helpers ───────────────────────────────────────────────────────────
// NOTE: Without the `tabs` permission, chrome.tabs.query does NOT return
// tab.url. We return the tab ID without URL validation and rely on
// executeScript failing gracefully for non-Instagram tabs.
async function getActiveTabId(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

// ── Rehydrate: read persisted state from the page ─────────────────────────
async function rehydrate(tabId: number): Promise<void> {
  try {
    const stateResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: function (): OutliersState | null {
        return (window as unknown as { __outliers_state?: OutliersState }).__outliers_state ?? null;
      },
    });
    const state = stateResult?.[0]?.result as OutliersState | null;
    if (state && state.status !== "idle") {
      renderState(state);
      return;
    }
  } catch {
    // Non-fatal — tab may not be scriptable yet
  }

  // No persisted state — just read followers
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: readFollowersFromPage,
    });
    const followers = result?.[0]?.result ?? null;
    if (followers && followers > 0) {
      showStats(followers, followers * 5);
      runBtn.disabled = false;
    } else {
      showStats(0, 0);
      runBtn.disabled = true;
    }
  } catch {
    showStats(0, 0);
    runBtn.disabled = true;
  }
}

// ── Listen for messages from injected script ──────────────────────────────
chrome.runtime.onMessage.addListener(function (
  msg: OutliersMessage,
  sender: chrome.runtime.MessageSender,
  _sendResponse: (response?: unknown) => void
): undefined {
  // Ignore messages from tabs we're not tracking
  if (cachedTabId != null && sender.tab?.id !== cachedTabId) return;

  if (msg.type === "outliers:state") {
    renderState(msg.state);
  } else if (msg.type === "outliers:reset") {
    hideProgress();
    hideResults();
    setButtonsForIdle();
    statusEl.textContent = "Outliers cleared.";
    statusEl.className = "status-msg";
    // Re-read followers to show stats card
    if (cachedTabId != null) {
      rehydrate(cachedTabId);
    }
  }
});

// ── Detect navigation to a different profile ──────────────────────────────
// Instagram is an SPA — profile-to-profile navigation uses pushState.
// To keep permissions minimal, we poll the tab URL (via executeScript) and
// reset state when the profile changes.
async function handleNavigation(details: { tabId: number; url: string }): Promise<void> {
  if (cachedTabId == null || details.tabId !== cachedTabId) return;

  const newProfile = getProfilePath(details.url);
  lastKnownUrl = details.url;

  // Navigating to a content permalink (/reel/XXX/, /p/XXX/) — keep current
  // state so opening a reel from scan results doesn't wipe the outliers list.
  if (newProfile === null && isContentPermalink(details.url)) return;

  // Same profile as before — no reset needed (covers returning from /reel/ overlay)
  if (newProfile === lastKnownProfile) return;

  lastKnownProfile = newProfile;

  // Fully reset the injected script (stops observer, unhides tiles, removes CSS)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      func: function () {
        const w = window as unknown as {
          __outliers_reset?: () => void;
          __outliers_state?: unknown;
          __outliers_active?: boolean;
        };
        if (typeof w.__outliers_reset === "function") {
          w.__outliers_reset();
        }
        // Clear in case injected.ts was never loaded (no reset function yet)
        w.__outliers_state = undefined;
        w.__outliers_active = false;
      },
    });
  } catch {
    // Non-fatal — tab may have navigated to a non-injectable page
  }

  hideProgress();
  hideResults();
  setButtonsForIdle();
  statusEl.textContent = "";
  statusEl.className = "status-msg";
  showLoading();

  // Delay for SPA DOM to settle, then re-read followers
  setTimeout(function () { rehydrate(details.tabId); }, 500);
}

async function readTabUrl(tabId: number): Promise<string | null> {
  try {
    const urlResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: function () { return window.location.href; },
    });
    return (urlResult?.[0]?.result as string | undefined) ?? null;
  } catch {
    return null;
  }
}

function stopNavigationPolling(): void {
  if (navPollTimer != null) {
    clearInterval(navPollTimer);
    navPollTimer = null;
  }
}

function startNavigationPolling(tabId: number): void {
  stopNavigationPolling();
  const intervalMs = 800;
  navPollTimer = window.setInterval(function () {
    if (navPollInFlight) return;
    navPollInFlight = true;

    readTabUrl(tabId)
      .then(function (url) {
        if (!url) return;
        if (lastKnownUrl == null) {
          lastKnownUrl = url;
          lastKnownProfile = getProfilePath(url);
          return;
        }
        if (url !== lastKnownUrl) {
          return handleNavigation({ tabId, url });
        }
      })
      .finally(function () {
        navPollInFlight = false;
      });
  }, intervalMs);
}

// ── Button handlers ───────────────────────────────────────────────────────
runBtn.addEventListener("click", async function () {
  setButtonsDisabled();
  statusEl.textContent = "";
  statusEl.className = "status-msg";

  try {
    const tabId = cachedTabId ?? (await getActiveTabId());
    if (!tabId) {
      showError("No active Instagram tab found.");
      setButtonsForIdle();
      return;
    }

    statusEl.textContent = "Starting scan\u2026";
    const limit = getScanLimitFromUI();
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (function (l: number | null) {
        (window as unknown as { __outliers_scan_limit: number | null | undefined }).__outliers_scan_limit = l;
      }) as unknown as () => void,
      args: [limit],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["injected.js"],
    });
    setButtonsForScanning();
    statusEl.textContent = "";
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    statusEl.textContent = message;
    statusEl.className = "status-msg error";
    setButtonsForIdle();
  }
});

stopBtn.addEventListener("click", async function () {
  setButtonsDisabled();

  try {
    const tabId = cachedTabId ?? (await getActiveTabId());
    if (tabId) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: function () {
          if (typeof window.__outliers_stop === "function") {
            window.__outliers_stop();
          }
        },
      });
    }
  } catch {
    // Tab may be closed — still reset local UI
  }

  hideProgress();
  hideResults();
  setButtonsForIdle();
  statusEl.textContent = "Scan stopped.";

  // Re-read followers
  if (cachedTabId != null) {
    showLoading();
    await rehydrate(cachedTabId);
  }
});

resetBtn.addEventListener("click", async function () {
  setButtonsDisabled();

  try {
    const tabId = cachedTabId ?? (await getActiveTabId());
    if (tabId) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: function () {
          if (typeof window.__outliers_reset === "function") {
            window.__outliers_reset();
          }
        },
      });
    }
  } catch {
    // Tab may be closed — still reset local UI
  }

  hideProgress();
  hideResults();
  setButtonsForIdle();
  statusEl.textContent = "Outliers cleared.";

  // Re-read followers
  if (cachedTabId != null) {
    showLoading();
    await rehydrate(cachedTabId);
  }
});

// ── Scan limit event listeners ───────────────────────────────────────────
for (let i = 0; i < presetBtns.length; i++) {
  presetBtns[i]!.addEventListener("click", function () {
    const val = this.getAttribute("data-limit");
    const limit = val === "all" ? null : parseInt(val ?? "", 10);
    const resolved = limit !== null && (isNaN(limit) || limit <= 0) ? null : limit;
    syncScanLimitUI(resolved);
    saveScanLimit(resolved);
  });
}

scanLimitInput.addEventListener("input", function () {
  const raw = parseInt(scanLimitInput.value, 10);
  const limit = isNaN(raw) || raw <= 0 ? null : raw;
  syncScanLimitUI(limit);
  saveScanLimit(limit);
});

// ── Init: determine tab and show initial state ───────────────────────────
async function init(): Promise<void> {
  const savedLimit = loadScanLimit();
  syncScanLimitUI(savedLimit);

  const tabId = await getActiveTabId();
  if (!tabId) {
    showError("Open an Instagram profile page first.");
    return;
  }
  cachedTabId = tabId;

  // Capture initial URL for navigation change detection
  try {
    const urlResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: function () { return window.location.href; },
    });
    lastKnownUrl = urlResult?.[0]?.result ?? null;
    if (lastKnownUrl) {
      lastKnownProfile = getProfilePath(lastKnownUrl);
    }
  } catch {
    // Non-fatal — URL tracking just won't work until first navigation
  }

  startNavigationPolling(tabId);
  window.addEventListener("beforeunload", stopNavigationPolling);

  await rehydrate(tabId);
}

init();
