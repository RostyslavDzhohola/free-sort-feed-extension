import { startHotReload } from "./hot-reload";
import { buildOutliersCsv, buildSavedCsv } from "./shared/export-csv";
import type {
  FilterMode,
  OutliersEntry,
  OutliersMessage,
  OutliersState,
  SavedReel,
} from "./types/state";

declare const __OUTLIERS_WATCH__: boolean;

if (__OUTLIERS_WATCH__) {
  startHotReload();
}

// ── DOM refs ──────────────────────────────────────────────────────────────
const statsArea = document.getElementById("stats-area") as HTMLDivElement;
const mainView = document.getElementById("main-view") as HTMLDivElement;
const savedView = document.getElementById("saved-view") as HTMLDivElement;
const viewOutliersBtn = document.getElementById("view-outliers-btn") as HTMLButtonElement;
const viewSavedBtn = document.getElementById("view-saved-btn") as HTMLButtonElement;
const helpBtn = document.getElementById("help-btn") as HTMLButtonElement | null;
const helpTooltip = document.getElementById("help-tooltip") as HTMLDivElement | null;
const helpWrap = helpBtn?.parentElement as HTMLDivElement | null;
const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const progressArea = document.getElementById("progress-area") as HTMLDivElement;
const progressFill = document.getElementById("progress-fill") as HTMLDivElement;
const progressText = document.getElementById("progress-text") as HTMLDivElement;
const resultsArea = document.getElementById("results-area") as HTMLDivElement;
const resultsMeta = document.getElementById("results-meta") as HTMLSpanElement;
const resultsList = document.getElementById("results-list") as HTMLDivElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const savedList = document.getElementById("saved-list") as HTMLDivElement;
const savedClearBtn = document.getElementById("saved-clear-btn") as HTMLButtonElement;
const savedExportBtn = document.getElementById("saved-export-btn") as HTMLButtonElement;
const savedStatusEl = document.getElementById("saved-status") as HTMLParagraphElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;

const scanLimitInput = document.getElementById("scan-limit-input") as HTMLInputElement;
const scanPresetBtns = document.querySelectorAll(".preset-btn") as NodeListOf<HTMLButtonElement>;

const filterModeBtns = document.querySelectorAll(".filter-mode-btn") as NodeListOf<HTMLButtonElement>;
const minViewsArea = document.getElementById("min-views-area") as HTMLDivElement;
const minViewsInput = document.getElementById("min-views-input") as HTMLInputElement;
const minPresetBtns = document.querySelectorAll(".min-preset-btn") as NodeListOf<HTMLButtonElement>;

// ── Local state ───────────────────────────────────────────────────────────
let cachedTabId: number | null = null;
let lastKnownUrl: string | null = null;
let lastKnownProfile: string | null = null;
let navPollTimer: number | null = null;
let navPollInFlight = false;

let selectedFilterMode: FilterMode = "ratio5x";
let selectedMinViews: number | null = null;
let currentRenderedState: OutliersState | null = null;
let latestFollowers: number | null = null;
let activePanelView: "outliers" | "saved" = "outliers";
let helpTooltipOpen = false;

const savedByUrl = new Map<string, SavedReel>();

// ── Storage keys ──────────────────────────────────────────────────────────
const SCAN_LIMIT_KEY = "outliers_scan_limit";
const FILTER_MODE_KEY = "outliers_filter_mode";
const MIN_VIEWS_KEY = "outliers_min_views";
const SAVED_REELS_KEY = "outliers_saved_reels";

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

function clearElement(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function switchPanelView(view: "outliers" | "saved"): void {
  activePanelView = view;
  if (view === "outliers") {
    mainView.style.display = "block";
    savedView.style.display = "none";
    statusEl.style.display = "block";
    viewOutliersBtn.classList.add("active");
    viewSavedBtn.classList.remove("active");
  } else {
    mainView.style.display = "none";
    savedView.style.display = "block";
    statusEl.style.display = "none";
    viewOutliersBtn.classList.remove("active");
    viewSavedBtn.classList.add("active");
  }
}

function setHelpTooltipOpen(open: boolean): void {
  helpTooltipOpen = open;
  if (!helpBtn || !helpTooltip) return;
  helpBtn.setAttribute("aria-expanded", open ? "true" : "false");
  helpTooltip.classList.toggle("visible", open);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "profile";
}

function getLocalTimestampForFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    "-",
    pad(d.getMonth() + 1),
    "-",
    pad(d.getDate()),
    "_",
    pad(d.getHours()),
    "-",
    pad(d.getMinutes()),
  ].join("");
}

function getThresholdLabel(mode: FilterMode, followers: number | null, minViews: number | null): string {
  if (mode === "minViews") {
    const resolved = minViews && minViews > 0 ? minViews : 10000;
    return formatExact(resolved) + " views";
  }
  if (followers && followers > 0) {
    return formatExact(followers * 5) + " views";
  }
  return "5× follower count";
}

// ── Scan limit helpers ────────────────────────────────────────────────────
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
    if (limit === null) localStorage.removeItem(SCAN_LIMIT_KEY);
    else localStorage.setItem(SCAN_LIMIT_KEY, String(limit));
  } catch {
    // Non-fatal
  }
}

function syncScanLimitUI(limit: number | null): void {
  if (limit === null) {
    scanLimitInput.value = "";
    scanLimitInput.placeholder = "Custom limit…";
  } else {
    scanLimitInput.value = String(limit);
  }

  for (let i = 0; i < scanPresetBtns.length; i++) {
    const btn = scanPresetBtns[i]!;
    const btnLimit = btn.getAttribute("data-limit");
    if (limit === null && btnLimit === "all") btn.classList.add("active");
    else if (btnLimit !== "all" && limit === Number(btnLimit)) btn.classList.add("active");
    else btn.classList.remove("active");
  }
}

function getScanLimitFromUI(): number | null {
  const raw = parseInt(scanLimitInput.value, 10);
  if (isNaN(raw) || raw <= 0) return null;
  return raw;
}

function setScanLimitControlsDisabled(disabled: boolean): void {
  scanLimitInput.disabled = disabled;
  for (let i = 0; i < scanPresetBtns.length; i++) {
    scanPresetBtns[i]!.disabled = disabled;
  }
}

// ── Filter mode helpers ───────────────────────────────────────────────────
function loadFilterMode(): FilterMode {
  try {
    return localStorage.getItem(FILTER_MODE_KEY) === "minViews" ? "minViews" : "ratio5x";
  } catch {
    return "ratio5x";
  }
}

function saveFilterMode(mode: FilterMode): void {
  try {
    localStorage.setItem(FILTER_MODE_KEY, mode);
  } catch {
    // Non-fatal
  }
}

function loadMinViews(): number | null {
  try {
    const raw = localStorage.getItem(MIN_VIEWS_KEY);
    if (!raw) return null;
    const num = parseInt(raw, 10);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
  } catch {
    return null;
  }
}

function saveMinViews(minViews: number | null): void {
  try {
    if (minViews == null) localStorage.removeItem(MIN_VIEWS_KEY);
    else localStorage.setItem(MIN_VIEWS_KEY, String(minViews));
  } catch {
    // Non-fatal
  }
}

function resolveMinViewsForRun(): number {
  const value = selectedMinViews ?? parseInt(minViewsInput.value, 10);
  if (!Number.isFinite(value) || value <= 0) return 10000;
  return value;
}

function syncFilterModeUI(mode: FilterMode): void {
  selectedFilterMode = mode;
  for (let i = 0; i < filterModeBtns.length; i++) {
    const btn = filterModeBtns[i]!;
    if (btn.getAttribute("data-mode") === mode) btn.classList.add("active");
    else btn.classList.remove("active");
  }
  minViewsArea.style.display = mode === "minViews" ? "block" : "none";
}

function syncMinViewsUI(minViews: number | null): void {
  selectedMinViews = minViews;
  minViewsInput.value = minViews ? String(minViews) : "";

  for (let i = 0; i < minPresetBtns.length; i++) {
    const btn = minPresetBtns[i]!;
    const candidate = parseInt(btn.getAttribute("data-min-views") ?? "", 10);
    if (candidate === minViews) btn.classList.add("active");
    else btn.classList.remove("active");
  }
}

function setFilterControlsDisabled(disabled: boolean): void {
  for (let i = 0; i < filterModeBtns.length; i++) {
    filterModeBtns[i]!.disabled = disabled;
  }
  minViewsInput.disabled = disabled || selectedFilterMode !== "minViews";
  for (let i = 0; i < minPresetBtns.length; i++) {
    minPresetBtns[i]!.disabled = disabled || selectedFilterMode !== "minViews";
  }
}

// ── Saved reels helpers ───────────────────────────────────────────────────
async function loadSavedReels(): Promise<void> {
  const result = await chrome.storage.local.get(SAVED_REELS_KEY);
  const saved = result[SAVED_REELS_KEY] as SavedReel[] | undefined;
  savedByUrl.clear();
  let needsMigration = false;

  if (Array.isArray(saved)) {
    for (let i = 0; i < saved.length; i++) {
      const row = saved[i]!;
      if (!row?.url) continue;
      const normalizedProfile = normalizeProfileUrl(row.profilePath ?? null, row.url);
      if (normalizedProfile !== (row.profilePath ?? null)) {
        needsMigration = true;
      }
      savedByUrl.set(row.url, {
        ...row,
        profilePath: normalizedProfile,
      });
    }
  }
  if (needsMigration) {
    await persistSavedReels();
  }
  renderSavedReels();
}

async function persistSavedReels(): Promise<void> {
  const list = getSortedSavedReels();
  await chrome.storage.local.set({ [SAVED_REELS_KEY]: list });
}

function getSortedSavedReels(): SavedReel[] {
  return Array.from(savedByUrl.values()).sort(function (a, b) {
    return Date.parse(b.savedAt) - Date.parse(a.savedAt);
  });
}

function isSaved(url: string): boolean {
  return savedByUrl.has(url);
}

async function saveReelFromResult(reel: OutliersEntry): Promise<void> {
  const saved: SavedReel = {
    ...reel,
    savedAt: nowIso(),
    profilePath: normalizeProfileUrl(lastKnownProfile, reel.url),
  };
  savedByUrl.set(reel.url, saved);
  await persistSavedReels();
  if (activePanelView === "saved") {
    renderSavedReels();
  }
  if (currentRenderedState?.status === "done") {
    renderResults(currentRenderedState.outliers, currentRenderedState.scannedCount, currentRenderedState);
  }
}

async function unsaveReel(url: string): Promise<void> {
  savedByUrl.delete(url);
  await persistSavedReels();
  if (activePanelView === "saved") {
    renderSavedReels();
  }
  if (currentRenderedState?.status === "done") {
    renderResults(currentRenderedState.outliers, currentRenderedState.scannedCount, currentRenderedState);
  }
}

async function clearSavedReels(): Promise<void> {
  savedByUrl.clear();
  await persistSavedReels();
  renderSavedReels();
  if (currentRenderedState?.status === "done") {
    renderResults(currentRenderedState.outliers, currentRenderedState.scannedCount, currentRenderedState);
  }
}

function renderSavedReels(): void {
  clearElement(savedList);
  savedStatusEl.textContent = "";
  savedStatusEl.className = "status-msg";
  const reels = getSortedSavedReels();

  if (reels.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-msg";
    empty.textContent = "No saved videos yet.";
    savedList.appendChild(empty);
    savedClearBtn.disabled = true;
    savedExportBtn.disabled = true;
    return;
  }

  savedClearBtn.disabled = false;
  savedExportBtn.disabled = false;

  for (let i = 0; i < reels.length; i++) {
    const reel = reels[i]!;
    const row = document.createElement("div");
    row.className = "saved-item";

    const info = document.createElement("div");
    info.className = "saved-info";

    const views = document.createElement("div");
    views.className = "result-views";
    views.textContent = formatCount(reel.views) + " views";

    const meta = document.createElement("div");
    meta.className = "saved-meta";
    meta.textContent = reel.ratio.toFixed(1) + "×";

    info.appendChild(views);
    info.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "result-actions";

    const open = document.createElement("a");
    open.className = "btn-sm open action-open";
    open.href = reel.url;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "Open";

    const remove = document.createElement("button");
    remove.className = "btn-sm remove action-tail";
    remove.textContent = "Delete";
    remove.addEventListener("click", function () {
      unsaveReel(reel.url).catch(function () {
        statusEl.textContent = "Failed to remove saved reel.";
        statusEl.className = "status-msg error";
      });
    });

    actions.appendChild(open);
    actions.appendChild(remove);

    row.appendChild(info);
    row.appendChild(actions);
    savedList.appendChild(row);
  }
}

// ── URL helpers ──────────────────────────────────────────────────────────
function getProfilePath(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/instagram\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const reserved = ["explore", "p", "stories", "direct", "accounts", "reel", "reels"];
    if (reserved.includes(parts[0]!.toLowerCase())) return null;
    return "/" + parts[0]!.toLowerCase();
  } catch {
    return null;
  }
}

function getProfileUrlFromReelUrl(reelUrl: string): string | null {
  try {
    const u = new URL(reelUrl);
    if (!/instagram\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length < 3) return null;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!.toLowerCase();
      if (part === "reel" || part === "reels" || part === "p") {
        const username = parts[i - 1];
        if (!username) return null;
        return u.origin + "/" + username.replace(/^@/, "") + "/";
      }
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeProfileUrl(profilePathOrUrl: string | null, reelUrl?: string): string | null {
  if (reelUrl) {
    const fromReel = getProfileUrlFromReelUrl(reelUrl);
    if (fromReel) return fromReel;
  }

  if (!profilePathOrUrl) return null;
  if (/^https?:\/\//i.test(profilePathOrUrl)) {
    return profilePathOrUrl.endsWith("/") ? profilePathOrUrl : profilePathOrUrl + "/";
  }
  if (profilePathOrUrl.startsWith("/")) {
    return "https://www.instagram.com" + profilePathOrUrl + (profilePathOrUrl.endsWith("/") ? "" : "/");
  }
  return "https://www.instagram.com/" + profilePathOrUrl.replace(/^@/, "") + "/";
}

function isContentPermalink(url: string): boolean {
  try {
    const u = new URL(url);
    return /^\/(reel|reels|p)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

// ── State normalization ───────────────────────────────────────────────────
function normalizeState(raw: OutliersState): OutliersState {
  const mode: FilterMode = raw.filterMode === "minViews" ? "minViews" : "ratio5x";
  const minViews = Number.isFinite(raw.minViews) && (raw.minViews ?? 0) > 0 ? raw.minViews : null;
  const followers = raw.followers && raw.followers > 0 ? raw.followers : null;
  const threshold = Number.isFinite(raw.threshold) && (raw.threshold ?? 0) > 0
    ? raw.threshold
    : mode === "ratio5x" && followers
      ? followers * 5
      : minViews;

  const activeThresholdLabel = raw.activeThresholdLabel
    ? raw.activeThresholdLabel
    : getThresholdLabel(mode, followers, minViews);

  return {
    ...raw,
    filterMode: mode,
    minViews: minViews,
    threshold: threshold ?? null,
    activeThresholdLabel,
  };
}

// ── UI rendering ──────────────────────────────────────────────────────────
function showStats(followers: number, thresholdLabel: string): void {
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
  label2.textContent = "Active threshold";
  const val2 = document.createElement("span");
  val2.className = "stat-value threshold";
  val2.textContent = thresholdLabel;
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
  wrapper.appendChild(document.createTextNode("Reading profile…"));
  statsArea.appendChild(wrapper);
}

function setProgress(scannedCount: number, scanLimit: number | null): void {
  progressArea.style.display = "block";
  if (scanLimit !== null && scanLimit > 0) {
    const pct = Math.min(100, (scannedCount / scanLimit) * 100);
    progressFill.style.width = pct + "%";
    progressFill.style.opacity = "1";
    progressFill.style.animation = "";
    progressText.textContent = "Scanning… " + scannedCount + " / " + scanLimit + " reels";
  } else {
    progressFill.style.width = "100%";
    progressFill.style.opacity = "0.4";
    progressFill.style.animation = "pulse 1.5s ease-in-out infinite";
    progressText.textContent = "Scanning… " + scannedCount + " reels found";
  }
}

function hideProgress(): void {
  progressArea.style.display = "none";
  progressFill.style.width = "0%";
  progressFill.style.opacity = "1";
  progressFill.style.animation = "";
}

function copyToClipboard(text: string, button: HTMLButtonElement): void {
  const isIconCopyButton = button.classList.contains("action-copy");

  function renderCopyIcon(target: HTMLButtonElement): void {
    target.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10.59 13.41a1 1 0 0 1 0-1.41l3.3-3.3a2 2 0 1 1 2.83 2.83l-1.3 1.3a1 1 0 0 0 1.42 1.41l1.3-1.29a4 4 0 1 0-5.66-5.66l-3.3 3.3a3 3 0 0 0 4.24 4.24l1.06-1.06a1 1 0 1 0-1.42-1.41L12 13.43a1 1 0 0 1-1.41-.02z"/><path fill="currentColor" d="M13.41 10.59a1 1 0 0 1 0 1.41l-3.3 3.3a2 2 0 1 1-2.83-2.83l1.3-1.3a1 1 0 0 0-1.42-1.41l-1.3 1.29a4 4 0 1 0 5.66 5.66l3.3-3.3a3 3 0 1 0-4.24-4.24L9.52 10.23a1 1 0 0 0 1.42 1.41L12 10.57a1 1 0 0 1 1.41.02z"/></svg>';
  }

  navigator.clipboard
    .writeText(text)
    .then(function () {
      if (isIconCopyButton) {
        button.textContent = "✓";
      } else {
        button.textContent = "Copied!";
      }
      setTimeout(function () {
        if (isIconCopyButton) {
          renderCopyIcon(button);
        } else {
          button.textContent = "Copy link";
        }
      }, 1500);
    })
    .catch(function () {
      if (isIconCopyButton) {
        button.textContent = "!";
      } else {
        button.textContent = "Failed";
      }
      setTimeout(function () {
        if (isIconCopyButton) {
          renderCopyIcon(button);
        } else {
          button.textContent = "Copy link";
        }
      }, 1500);
    });
}

function renderResults(outliers: OutliersEntry[], scannedCount: number, state: OutliersState): void {
  resultsArea.style.display = "block";
  resultsMeta.textContent = "— " + outliers.length + " of " + scannedCount + " reels";
  clearElement(resultsList);

  if (outliers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-msg";
    empty.textContent = state.filterMode === "minViews"
      ? "No Reels reached the minimum views threshold."
      : "No Reels reached the 5× threshold.";
    resultsList.appendChild(empty);
    exportBtn.disabled = true;
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
    ratio.textContent = reel.ratio.toFixed(1) + "×";
    info.appendChild(views);
    info.appendChild(ratio);

    const actions = document.createElement("div");
    actions.className = "result-actions";

    const openLink = document.createElement("a");
    openLink.className = "btn-sm open action-open";
    openLink.href = reel.url;
    openLink.target = "_blank";
    openLink.rel = "noopener";
    openLink.textContent = "Open";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-sm action-copy";
    copyBtn.setAttribute("aria-label", "Copy a link");
    copyBtn.setAttribute("title", "Copy a link");
    copyBtn.setAttribute("data-tooltip", "Copy a link");
    copyBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10.59 13.41a1 1 0 0 1 0-1.41l3.3-3.3a2 2 0 1 1 2.83 2.83l-1.3 1.3a1 1 0 0 0 1.42 1.41l1.3-1.29a4 4 0 1 0-5.66-5.66l-3.3 3.3a3 3 0 0 0 4.24 4.24l1.06-1.06a1 1 0 1 0-1.42-1.41L12 13.43a1 1 0 0 1-1.41-.02z"/><path fill="currentColor" d="M13.41 10.59a1 1 0 0 1 0 1.41l-3.3 3.3a2 2 0 1 1-2.83-2.83l1.3-1.3a1 1 0 0 0-1.42-1.41l-1.3 1.29a4 4 0 1 0 5.66 5.66l3.3-3.3a3 3 0 1 0-4.24-4.24L9.52 10.23a1 1 0 0 0 1.42 1.41L12 10.57a1 1 0 0 1 1.41.02z"/></svg>';
    copyBtn.addEventListener("click", function () {
      copyToClipboard(reel.url, copyBtn);
    });

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-sm action-tail";
    const currentlySaved = isSaved(reel.url);
    saveBtn.textContent = currentlySaved ? "Delete" : "Save";
    saveBtn.classList.add(currentlySaved ? "remove" : "save");

    saveBtn.addEventListener("click", function () {
      const op = isSaved(reel.url) ? unsaveReel(reel.url) : saveReelFromResult(reel);
      op.catch(function () {
        statusEl.textContent = "Failed to update saved reels.";
        statusEl.className = "status-msg error";
      });
    });

    actions.appendChild(openLink);
    actions.appendChild(copyBtn);
    actions.appendChild(saveBtn);

    item.appendChild(rank);
    item.appendChild(info);
    item.appendChild(actions);
    resultsList.appendChild(item);
  }

  exportBtn.disabled = false;
}

function hideResults(): void {
  resultsArea.style.display = "none";
  clearElement(resultsList);
  exportBtn.disabled = true;
}

function setButtonsForIdle(): void {
  runBtn.style.display = "block";
  runBtn.disabled = false;
  stopBtn.style.display = "none";
  resetBtn.style.display = "none";
  setScanLimitControlsDisabled(false);
  setFilterControlsDisabled(false);
}

function setButtonsForScanning(): void {
  runBtn.style.display = "none";
  stopBtn.style.display = "block";
  stopBtn.disabled = false;
  resetBtn.style.display = "none";
  setScanLimitControlsDisabled(true);
  setFilterControlsDisabled(true);
  exportBtn.disabled = true;
}

function setButtonsForDone(): void {
  runBtn.style.display = "none";
  stopBtn.style.display = "none";
  resetBtn.style.display = "block";
  resetBtn.disabled = false;
  setScanLimitControlsDisabled(false);
  setFilterControlsDisabled(false);
}

function setButtonsDisabled(): void {
  runBtn.disabled = true;
  stopBtn.disabled = true;
  resetBtn.disabled = true;
}

function renderState(rawState: OutliersState): void {
  const state = normalizeState(rawState);
  currentRenderedState = state;
  if (state.followers && state.followers > 0) latestFollowers = state.followers;

  selectedFilterMode = state.filterMode;
  selectedMinViews = state.minViews;
  syncFilterModeUI(state.filterMode);
  syncMinViewsUI(state.minViews);
  saveFilterMode(state.filterMode);
  saveMinViews(state.minViews);

  statusEl.textContent = "";
  statusEl.className = "status-msg";

  if (state.followers) {
    showStats(state.followers, state.activeThresholdLabel);
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
      renderResults(state.outliers, state.scannedCount, state);
      setButtonsForDone();
      if (state.outliers.length === 0) {
        statusEl.textContent =
          "No reels matched this filter. Page scrolling is locked while zero-result filtering is active. Click Reset to restore the full grid.";
        statusEl.className = "status-msg";
      } else {
        statusEl.textContent = "";
        statusEl.className = "status-msg";
      }
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
function readFollowersFromPage(): number | null {
  const path = window.location.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;
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
async function getActiveTabId(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function rehydrate(tabId: number): Promise<void> {
  try {
    const stateResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: function (): OutliersState | null {
        return (window as unknown as { __outliers_state?: OutliersState }).__outliers_state ?? null;
      },
    });
    const rawState = stateResult?.[0]?.result as OutliersState | null;
    if (rawState && rawState.status !== "idle") {
      renderState(rawState);
      return;
    }
  } catch {
    // Non-fatal
  }

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: readFollowersFromPage,
    });
    const followers = result?.[0]?.result ?? null;

    if (followers && followers > 0) {
      latestFollowers = followers;
      showStats(followers, getThresholdLabel(selectedFilterMode, followers, selectedMinViews));
      runBtn.disabled = false;
    } else {
      latestFollowers = null;
      showStats(0, "—");
      runBtn.disabled = true;
    }
  } catch {
    latestFollowers = null;
    showStats(0, "—");
    runBtn.disabled = true;
  }
}

// ── Message listener ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (
  msg: OutliersMessage,
  sender: chrome.runtime.MessageSender,
  _sendResponse: (response?: unknown) => void
): undefined {
  if (cachedTabId != null && sender.tab?.id !== cachedTabId) return;

  if (msg.type === "outliers:state") {
    renderState(msg.state);
  } else if (msg.type === "outliers:reset") {
    hideProgress();
    hideResults();
    setButtonsForIdle();
    statusEl.textContent = "Outliers cleared.";
    statusEl.className = "status-msg";
    currentRenderedState = null;
    if (cachedTabId != null) rehydrate(cachedTabId);
  }
});

// ── Navigation detection ──────────────────────────────────────────────────
async function handleNavigation(details: { tabId: number; url: string }): Promise<void> {
  if (cachedTabId == null || details.tabId !== cachedTabId) return;

  const newProfile = getProfilePath(details.url);
  lastKnownUrl = details.url;

  if (newProfile === null && isContentPermalink(details.url)) return;
  if (newProfile === lastKnownProfile) return;

  lastKnownProfile = newProfile;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      func: function () {
        const w = window as unknown as {
          __outliers_reset?: () => void;
          __outliers_state?: unknown;
          __outliers_active?: boolean;
        };
        if (typeof w.__outliers_reset === "function") w.__outliers_reset();
        w.__outliers_state = undefined;
        w.__outliers_active = false;
      },
    });
  } catch {
    // Non-fatal
  }

  hideProgress();
  hideResults();
  setButtonsForIdle();
  currentRenderedState = null;
  statusEl.textContent = "";
  statusEl.className = "status-msg";
  showLoading();

  setTimeout(function () {
    rehydrate(details.tabId);
  }, 500);
}

async function readTabUrl(tabId: number): Promise<string | null> {
  try {
    const urlResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: function () {
        return window.location.href;
      },
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
        if (url !== lastKnownUrl) return handleNavigation({ tabId, url });
      })
      .finally(function () {
        navPollInFlight = false;
      });
  }, 800);
}

// ── CSV export ────────────────────────────────────────────────────────────
function exportCurrentResults(): void {
  if (!currentRenderedState || currentRenderedState.status !== "done") {
    statusEl.textContent = "Run a scan first to export CSV.";
    statusEl.className = "status-msg error";
    return;
  }

  if (currentRenderedState.outliers.length === 0) {
    statusEl.textContent = "No outliers to export for the current filters.";
    statusEl.className = "status-msg error";
    return;
  }

  const csv = buildOutliersCsv(currentRenderedState.outliers, {
    profilePath: normalizeProfileUrl(
      lastKnownProfile,
      currentRenderedState.outliers[0]?.url
    ),
    filterMode: currentRenderedState.filterMode,
    thresholdLabel: currentRenderedState.activeThresholdLabel,
    exportedAt: nowIso(),
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = [
    "outliers",
    sanitizeFilenamePart(lastKnownProfile ?? "profile"),
    getLocalTimestampForFilename(),
  ].join("_") + ".csv";

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  statusEl.textContent = "CSV exported.";
  statusEl.className = "status-msg";
}

function exportSavedResults(): void {
  const reels = getSortedSavedReels().map(function (reel) {
    return {
      ...reel,
      profilePath: normalizeProfileUrl(reel.profilePath, reel.url),
    };
  });
  if (reels.length === 0) {
    savedStatusEl.textContent = "No saved videos to export.";
    savedStatusEl.className = "status-msg error";
    return;
  }

  const csv = buildSavedCsv(reels, { exportedAt: nowIso() });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "saved_videos_" + getLocalTimestampForFilename() + ".csv";

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  savedStatusEl.textContent = "CSV exported.";
  savedStatusEl.className = "status-msg";
}

// ── Event handlers ────────────────────────────────────────────────────────
if (helpBtn) {
  helpBtn.addEventListener("click", function (ev) {
    ev.stopPropagation();
    setHelpTooltipOpen(!helpTooltipOpen);
  });

  helpBtn.addEventListener("mouseenter", function () {
    setHelpTooltipOpen(true);
  });

  helpBtn.addEventListener("focus", function () {
    setHelpTooltipOpen(true);
  });
}

if (helpWrap) {
  helpWrap.addEventListener("mouseleave", function () {
    setHelpTooltipOpen(false);
  });
}

document.addEventListener("click", function (ev) {
  if (!helpTooltipOpen || !helpWrap) return;
  const target = ev.target as Node | null;
  if (!target || !helpWrap.contains(target)) {
    setHelpTooltipOpen(false);
  }
});

document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape") {
    setHelpTooltipOpen(false);
  }
});

viewOutliersBtn.addEventListener("click", function () {
  switchPanelView("outliers");
});

viewSavedBtn.addEventListener("click", function () {
  switchPanelView("saved");
  renderSavedReels();
});

savedExportBtn.addEventListener("click", function () {
  exportSavedResults();
});

savedClearBtn.addEventListener("click", function () {
  clearSavedReels().catch(function () {
    savedStatusEl.textContent = "Failed to clear saved reels.";
    savedStatusEl.className = "status-msg error";
  });
});

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

    const limit = getScanLimitFromUI();
    const mode = selectedFilterMode;
    const minViews = mode === "minViews" ? resolveMinViewsForRun() : null;

    saveFilterMode(mode);
    saveMinViews(minViews);
    syncMinViewsUI(minViews);

    statusEl.textContent = "Starting scan…";

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (function (l: number | null, m: FilterMode, min: number | null) {
        const w = window as unknown as {
          __outliers_scan_limit: number | null | undefined;
          __outliers_filter_mode: FilterMode | undefined;
          __outliers_min_views: number | null | undefined;
        };
        w.__outliers_scan_limit = l;
        w.__outliers_filter_mode = m;
        w.__outliers_min_views = min;
      }) as unknown as () => void,
      args: [limit, mode, minViews],
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
          if (typeof window.__outliers_stop === "function") window.__outliers_stop();
        },
      });
    }
  } catch {
    // Non-fatal
  }

  hideProgress();
  hideResults();
  setButtonsForIdle();
  statusEl.textContent = "Scan stopped.";

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
          if (typeof window.__outliers_reset === "function") window.__outliers_reset();
        },
      });
    }
  } catch {
    // Non-fatal
  }

  hideProgress();
  hideResults();
  setButtonsForIdle();
  currentRenderedState = null;
  statusEl.textContent = "Outliers cleared.";

  if (cachedTabId != null) {
    showLoading();
    await rehydrate(cachedTabId);
  }
});

for (let i = 0; i < scanPresetBtns.length; i++) {
  scanPresetBtns[i]!.addEventListener("click", function () {
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

for (let i = 0; i < filterModeBtns.length; i++) {
  filterModeBtns[i]!.addEventListener("click", function () {
    const mode = this.getAttribute("data-mode") === "minViews" ? "minViews" : "ratio5x";
    syncFilterModeUI(mode);
    if (mode === "minViews" && (!selectedMinViews || selectedMinViews <= 0)) {
      syncMinViewsUI(10000);
      saveMinViews(10000);
    }
    saveFilterMode(mode);
    setFilterControlsDisabled(false);

    if (currentRenderedState?.status !== "done" && latestFollowers) {
      showStats(
        latestFollowers,
        getThresholdLabel(mode, latestFollowers, selectedMinViews)
      );
    }
  });
}

for (let i = 0; i < minPresetBtns.length; i++) {
  minPresetBtns[i]!.addEventListener("click", function () {
    const value = parseInt(this.getAttribute("data-min-views") ?? "", 10);
    const resolved = Number.isFinite(value) && value > 0 ? value : 10000;
    syncMinViewsUI(resolved);
    saveMinViews(resolved);
  });
}

minViewsInput.addEventListener("input", function () {
  const raw = parseInt(minViewsInput.value, 10);
  const minViews = isNaN(raw) || raw <= 0 ? null : raw;
  syncMinViewsUI(minViews);
  saveMinViews(minViews);
});

exportBtn.addEventListener("click", exportCurrentResults);

// ── Init ─────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  setHelpTooltipOpen(false);
  switchPanelView("outliers");
  syncScanLimitUI(loadScanLimit());
  syncFilterModeUI(loadFilterMode());
  syncMinViewsUI(loadMinViews());
  setFilterControlsDisabled(false);
  await loadSavedReels();

  const tabId = await getActiveTabId();
  if (!tabId) {
    showError("Open an Instagram profile page first.");
    return;
  }

  cachedTabId = tabId;

  try {
    const urlResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: function () {
        return window.location.href;
      },
    });
    lastKnownUrl = (urlResult?.[0]?.result as string | undefined) ?? null;
    if (lastKnownUrl) lastKnownProfile = getProfilePath(lastKnownUrl);
  } catch {
    // Non-fatal
  }

  startNavigationPolling(tabId);
  window.addEventListener("beforeunload", stopNavigationPolling);

  await rehydrate(tabId);
}

init();
