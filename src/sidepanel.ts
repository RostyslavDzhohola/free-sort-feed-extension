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
const copyOutliersBtn = document.getElementById("copy-outliers-btn") as HTMLButtonElement;
const shareOutliersBtn = document.getElementById("share-outliers-btn") as HTMLButtonElement;
const savedList = document.getElementById("saved-list") as HTMLDivElement;
const savedClearBtn = document.getElementById("saved-clear-btn") as HTMLButtonElement;
const savedExportBtn = document.getElementById("saved-export-btn") as HTMLButtonElement;
const savedStatusEl = document.getElementById("saved-status") as HTMLParagraphElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const reviewPromptEl = document.getElementById("review-prompt") as HTMLDivElement;
const reviewPromptDismissBtn = document.getElementById("review-prompt-dismiss-btn") as HTMLButtonElement;
const reviewPromptRateBtn = document.getElementById("review-prompt-rate-btn") as HTMLButtonElement;
const reviewDevModeRow = document.getElementById("review-dev-mode-row") as HTMLLIElement | null;
const reviewDevModeBtn = document.getElementById("review-dev-mode-btn") as HTMLButtonElement | null;
const reviewDevModeLabel = document.getElementById("review-dev-mode-label") as HTMLSpanElement | null;
const reviewDevDebugEl = document.getElementById("review-dev-debug") as HTMLLIElement | null;
const shareModalEl = document.getElementById("share-modal") as HTMLDivElement;
const shareDownloadStoryBtn = document.getElementById("share-download-story-btn") as HTMLButtonElement;
const shareCopyCaptionBtn = document.getElementById("share-copy-caption-btn") as HTMLButtonElement;
const shareCopyLinksBtn = document.getElementById("share-copy-links-btn") as HTMLButtonElement;
const shareCloseBtn = document.getElementById("share-close-btn") as HTMLButtonElement;

const scanLimitSlider = document.getElementById("scan-limit-slider") as HTMLInputElement;
const scanLimitValue = document.getElementById("scan-limit-value") as HTMLSpanElement;

const filterModeBtns = document.querySelectorAll(".filter-mode-btn") as NodeListOf<HTMLButtonElement>;
const minViewsArea = document.getElementById("min-views-area") as HTMLDivElement;
const minViewsSlider = document.getElementById("min-views-slider") as HTMLInputElement;
const minViewsValue = document.getElementById("min-views-value") as HTMLSpanElement;

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
let reviewPromptState: ReviewPromptState = createDefaultReviewPromptState();
let reviewPromptShownThisSession = false;
let reviewPromptClosedThisSession = false;
let reviewPromptEligibleSinceMs: number | null = null;
let reviewPromptDelayTimer: number | null = null;
let reviewPromptDevMode: ReviewPromptDevMode = "auto";
let storyCardGenerationInFlight = false;

const savedByUrl = new Map<string, SavedReel>();

// ── Storage keys ──────────────────────────────────────────────────────────
const SCAN_LIMIT_KEY = "outliers_scan_limit";
const FILTER_MODE_KEY = "outliers_filter_mode";
const MIN_VIEWS_KEY = "outliers_min_views";
const SAVED_REELS_KEY = "outliers_saved_reels";
const REVIEW_PROMPT_STATE_KEY = "outliers_review_prompt_state";
// Persisted in localStorage so you can flip modal testing modes quickly.
const REVIEW_PROMPT_DEV_MODE_KEY = "outliers_review_prompt_dev_mode";

const REVIEW_PROMPT_POST_REVIEW_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_NOT_NOW_BASE_COOLDOWN_MS = 30 * 60 * 1000;
const REVIEW_PROMPT_NOT_NOW_SECOND_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const REVIEW_PROMPT_NOT_NOW_MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_MAX_PROMPTS_PER_DAY = 2;
const REVIEW_URL = "https://chromewebstore.google.com/detail/outliers/heogkfpbeagpoodininnfhdgjmpdalgj/reviews";
// Keep activation broad: show after the first successful 5x result set.
const REVIEW_PROMPT_MIN_OUTLIERS = 1;
// Delay the ask so users can scan results first before we interrupt them.
const REVIEW_PROMPT_DELAY_MS = 20_000;
const DEFAULT_MIN_VIEWS = 10_000;

const SCAN_LIMIT_MIN = 1;
const SCAN_LIMIT_MAX = 975;
const SCAN_SLIDER_MAX = 1000;
const SCAN_LIMIT_ANCHORS = [1, 100, 150, 200, 500] as const;
const SCAN_LIMIT_SNAP_VALUES = [
  1, 100, 150, 200,
  500, 525, 550, 575, 600, 625, 650, 675, 700, 725, 750, 775, 800, 825, 850, 875, 900, 925, 950, 975,
] as const;
const SCAN_LIMIT_SNAP_DISTANCE = 16;
const SCAN_SEGMENT_WIDTH = SCAN_SLIDER_MAX / SCAN_LIMIT_ANCHORS.length;
const SCAN_PRE_ALL_START_POSITION = SCAN_SEGMENT_WIDTH * (SCAN_LIMIT_ANCHORS.length - 1);
const SCAN_PRE_ALL_END_POSITION = SCAN_SLIDER_MAX - 1;
const SCAN_PRE_ALL_MIN = 500;
const SCAN_PRE_ALL_MAX = 975;

const MIN_VIEWS_MIN = 1_000;
const MIN_VIEWS_MAX = 1_000_000;
const MIN_VIEWS_SLIDER_MAX = 1000;
const MIN_VIEWS_MARKERS = [1_000, 10_000, 100_000, 1_000_000] as const;
const MIN_VIEWS_SNAP_DISTANCE = 24;

interface ReviewPromptState {
  firstSuccessfulScanAt: string | null;
  lastPromptAt: string | null;
  lastPromptDay: string | null;
  promptsShownToday: number;
  lastDismissedAt: string | null;
  dismissCount: number;
  lastReviewVisitAt: string | null;
  promptCount: number;
}

type ReviewPromptDevMode = "auto" | "forceOn" | "forceOff";

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ratioToLogValue(ratio: number, min: number, max: number): number {
  if (min <= 0 || max <= 0) return min;
  const safeRatio = clamp(ratio, 0, 1);
  const minLog = Math.log(min);
  const maxLog = Math.log(max);
  return Math.exp(minLog + (maxLog - minLog) * safeRatio);
}

function logValueToRatio(value: number, min: number, max: number): number {
  if (min <= 0 || max <= 0 || min === max) return 0;
  const safeValue = clamp(value, min, max);
  const minLog = Math.log(min);
  const maxLog = Math.log(max);
  return (Math.log(safeValue) - minLog) / (maxLog - minLog);
}

function getRangeValue(slider: HTMLInputElement): number {
  const parsed = parseInt(slider.value, 10);
  const min = parseInt(slider.min || "0", 10);
  const max = parseInt(slider.max || "100", 10);
  if (!Number.isFinite(parsed)) return min;
  return clamp(parsed, min, max);
}

function paintRange(slider: HTMLInputElement): void {
  const min = parseInt(slider.min || "0", 10);
  const max = parseInt(slider.max || "100", 10);
  const val = getRangeValue(slider);
  const pct = max <= min ? 0 : ((val - min) / (max - min)) * 100;
  slider.style.setProperty("--range-progress", pct.toFixed(2) + "%");
}

function formatScanLimitValue(limit: number | null): string {
  return limit === null ? "All reels" : formatExact(limit) + " reels";
}

function normalizeScanLimit(limit: number | null): number | null {
  if (limit == null) return null;
  return clamp(Math.round(limit), SCAN_LIMIT_MIN, SCAN_LIMIT_MAX);
}

function roundScanLimitValue(raw: number): number {
  const value = clamp(raw, SCAN_LIMIT_MIN, SCAN_LIMIT_MAX);
  if (value <= 20) return Math.round(value);
  if (value <= 200) return Math.round(value / 5) * 5;
  return Math.round(value / 25) * 25;
}

function interpolateGeometric(start: number, end: number, t: number): number {
  if (start <= 0 || end <= 0 || start === end) return start;
  return start * Math.pow(end / start, clamp(t, 0, 1));
}

function inverseGeometric(value: number, start: number, end: number): number {
  if (start <= 0 || end <= 0 || start === end) return 0;
  const safe = clamp(value, Math.min(start, end), Math.max(start, end));
  return Math.log(safe / start) / Math.log(end / start);
}

function scanLimitToSliderPosition(limit: number | null): number {
  if (limit == null) return SCAN_SLIDER_MAX;
  const safe = normalizeScanLimit(limit) ?? SCAN_LIMIT_MIN;

  if (safe > SCAN_PRE_ALL_MIN) {
    const t = (safe - SCAN_PRE_ALL_MIN) / (SCAN_PRE_ALL_MAX - SCAN_PRE_ALL_MIN);
    return Math.round(
      SCAN_PRE_ALL_START_POSITION + (t * (SCAN_PRE_ALL_END_POSITION - SCAN_PRE_ALL_START_POSITION))
    );
  }

  for (let i = 0; i < SCAN_LIMIT_ANCHORS.length - 1; i++) {
    const start = SCAN_LIMIT_ANCHORS[i]!;
    const end = SCAN_LIMIT_ANCHORS[i + 1]!;
    if (safe >= start && safe <= end) {
      const t = inverseGeometric(safe, start, end);
      return Math.round((i * SCAN_SEGMENT_WIDTH) + (t * SCAN_SEGMENT_WIDTH));
    }
  }

  return SCAN_PRE_ALL_START_POSITION;
}

function sliderPositionToScanLimit(position: number): number | null {
  const safePosition = Math.round(clamp(position, 0, SCAN_SLIDER_MAX));
  if (safePosition >= SCAN_SLIDER_MAX) return null;

  let rawLimit: number;
  if (safePosition >= SCAN_PRE_ALL_START_POSITION) {
    const localT =
      (safePosition - SCAN_PRE_ALL_START_POSITION) /
      (SCAN_PRE_ALL_END_POSITION - SCAN_PRE_ALL_START_POSITION);
    rawLimit = SCAN_PRE_ALL_MIN + (localT * (SCAN_PRE_ALL_MAX - SCAN_PRE_ALL_MIN));
  } else {
    const segmentIndex = Math.min(
      SCAN_LIMIT_ANCHORS.length - 2,
      Math.floor(safePosition / SCAN_SEGMENT_WIDTH)
    );
    const segmentStartPosition = segmentIndex * SCAN_SEGMENT_WIDTH;
    const localT = (safePosition - segmentStartPosition) / SCAN_SEGMENT_WIDTH;
    const segmentStartValue = SCAN_LIMIT_ANCHORS[segmentIndex]!;
    const segmentEndValue = SCAN_LIMIT_ANCHORS[segmentIndex + 1]!;
    rawLimit = interpolateGeometric(segmentStartValue, segmentEndValue, localT);
  }

  let closestAnchor = roundScanLimitValue(rawLimit);
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SCAN_LIMIT_SNAP_VALUES.length; i++) {
    const anchor = SCAN_LIMIT_SNAP_VALUES[i]!;
    const anchorPosition = scanLimitToSliderPosition(anchor);
    const distance = Math.abs(safePosition - anchorPosition);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestAnchor = anchor;
    }
  }
  if (closestAnchor != null && closestDistance <= SCAN_LIMIT_SNAP_DISTANCE) {
    return closestAnchor;
  }

  return roundScanLimitValue(rawLimit);
}

function normalizeMinViews(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return clamp(Math.round(value), MIN_VIEWS_MIN, MIN_VIEWS_MAX);
}

function roundMinViewsValue(raw: number): number {
  const safe = clamp(raw, MIN_VIEWS_MIN, MIN_VIEWS_MAX);
  if (safe < 10_000) return Math.round(safe / 100) * 100;
  if (safe < 100_000) return Math.round(safe / 1_000) * 1_000;
  return Math.round(safe / 10_000) * 10_000;
}

function minViewsToSliderPosition(value: number): number {
  const safe = clamp(Math.round(value), MIN_VIEWS_MIN, MIN_VIEWS_MAX);
  const ratio = logValueToRatio(safe, MIN_VIEWS_MIN, MIN_VIEWS_MAX);
  return Math.round(ratio * MIN_VIEWS_SLIDER_MAX);
}

function sliderPositionToMinViews(position: number): number {
  const safePosition = Math.round(clamp(position, 0, MIN_VIEWS_SLIDER_MAX));
  let closestMarker: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < MIN_VIEWS_MARKERS.length; i++) {
    const marker = MIN_VIEWS_MARKERS[i]!;
    const markerPosition = minViewsToSliderPosition(marker);
    const distance = Math.abs(safePosition - markerPosition);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestMarker = marker;
    }
  }

  if (closestMarker != null && closestDistance <= MIN_VIEWS_SNAP_DISTANCE) {
    return closestMarker;
  }

  const ratio = safePosition / MIN_VIEWS_SLIDER_MAX;
  const raw = ratioToLogValue(ratio, MIN_VIEWS_MIN, MIN_VIEWS_MAX);
  return roundMinViewsValue(raw);
}

function clearElement(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function switchPanelView(view: "outliers" | "saved"): void {
  activePanelView = view;
  if (view === "outliers") {
    closeShareModal();
    mainView.style.display = "block";
    savedView.style.display = "none";
    statusEl.style.display = "block";
    updateReviewPromptVisibility(currentRenderedState);
    viewOutliersBtn.classList.add("active");
    viewSavedBtn.classList.remove("active");
  } else {
    closeShareModal();
    mainView.style.display = "none";
    savedView.style.display = "block";
    statusEl.style.display = "none";
    hideReviewPrompt();
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

function createDefaultReviewPromptState(): ReviewPromptState {
  return {
    firstSuccessfulScanAt: null,
    lastPromptAt: null,
    lastPromptDay: null,
    promptsShownToday: 0,
    lastDismissedAt: null,
    dismissCount: 0,
    lastReviewVisitAt: null,
    promptCount: 0,
  };
}

function normalizeReviewPromptState(raw: unknown): ReviewPromptState {
  const base = createDefaultReviewPromptState();
  if (!raw || typeof raw !== "object") return base;
  const candidate = raw as Partial<ReviewPromptState> & { reviewClickedAt?: unknown };
  const legacyReviewClickedAt = typeof candidate.reviewClickedAt === "string" ? candidate.reviewClickedAt : null;
  return {
    firstSuccessfulScanAt: typeof candidate.firstSuccessfulScanAt === "string" ? candidate.firstSuccessfulScanAt : null,
    lastPromptAt: typeof candidate.lastPromptAt === "string" ? candidate.lastPromptAt : null,
    lastPromptDay: typeof candidate.lastPromptDay === "string" ? candidate.lastPromptDay : null,
    promptsShownToday:
      Number.isFinite(candidate.promptsShownToday) && (candidate.promptsShownToday ?? 0) >= 0
        ? Math.floor(candidate.promptsShownToday as number)
        : 0,
    lastDismissedAt: typeof candidate.lastDismissedAt === "string" ? candidate.lastDismissedAt : null,
    dismissCount:
      Number.isFinite(candidate.dismissCount) && (candidate.dismissCount ?? 0) >= 0
        ? Math.floor(candidate.dismissCount as number)
        : (typeof candidate.lastDismissedAt === "string" ? 1 : 0),
    lastReviewVisitAt:
      typeof candidate.lastReviewVisitAt === "string"
        ? candidate.lastReviewVisitAt
        : legacyReviewClickedAt,
    promptCount: Number.isFinite(candidate.promptCount) && (candidate.promptCount ?? 0) >= 0
      ? Math.floor(candidate.promptCount as number)
      : 0,
  };
}

function loadReviewPromptDevMode(): ReviewPromptDevMode {
  try {
    const raw = localStorage.getItem(REVIEW_PROMPT_DEV_MODE_KEY);
    if (raw === "forceOn" || raw === "forceOff") return raw;
    return "auto";
  } catch {
    return "auto";
  }
}

function saveReviewPromptDevMode(mode: ReviewPromptDevMode): void {
  try {
    localStorage.setItem(REVIEW_PROMPT_DEV_MODE_KEY, mode);
  } catch {
    // Non-fatal
  }
}

function getReviewDevModeLabel(mode: ReviewPromptDevMode): string {
  if (mode === "forceOn") return "ON";
  if (mode === "forceOff") return "OFF";
  return "AUTO";
}

function syncReviewPromptDevModeUI(): void {
  if (!reviewDevModeLabel || !reviewDevModeBtn) return;
  const stateLabel = getReviewDevModeLabel(reviewPromptDevMode);
  reviewDevModeLabel.textContent = stateLabel;
  reviewDevModeBtn.setAttribute("aria-label", "Review modal dev mode " + stateLabel);
}

function setReviewPromptDebug(message: string): void {
  if (!__OUTLIERS_WATCH__ || !reviewDevDebugEl) return;
  // Helps quickly diagnose why AUTO did/didn't show without opening console.
  reviewDevDebugEl.textContent = "Review modal: " + message;
}

function clearReviewPromptDelayTimer(): void {
  if (reviewPromptDelayTimer == null) return;
  clearTimeout(reviewPromptDelayTimer);
  reviewPromptDelayTimer = null;
}

function clearReviewPromptDelayState(): void {
  reviewPromptEligibleSinceMs = null;
  clearReviewPromptDelayTimer();
}

function scheduleReviewPromptDelayRefresh(waitMs: number): void {
  if (reviewPromptDelayTimer != null) return;
  reviewPromptDelayTimer = window.setTimeout(function () {
    reviewPromptDelayTimer = null;
    updateReviewPromptVisibility(currentRenderedState);
  }, waitMs);
}

function cycleReviewPromptDevMode(): void {
  // Simple cycle keeps testing quick: AUTO -> FORCE ON -> FORCE OFF -> AUTO.
  if (reviewPromptDevMode === "auto") reviewPromptDevMode = "forceOn";
  else if (reviewPromptDevMode === "forceOn") reviewPromptDevMode = "forceOff";
  else reviewPromptDevMode = "auto";
  saveReviewPromptDevMode(reviewPromptDevMode);
  syncReviewPromptDevModeUI();
}

async function loadReviewPromptState(): Promise<ReviewPromptState> {
  try {
    const result = await chrome.storage.local.get(REVIEW_PROMPT_STATE_KEY);
    return normalizeReviewPromptState(result[REVIEW_PROMPT_STATE_KEY]);
  } catch {
    return createDefaultReviewPromptState();
  }
}

async function saveReviewPromptState(state: ReviewPromptState): Promise<void> {
  try {
    await chrome.storage.local.set({ [REVIEW_PROMPT_STATE_KEY]: state });
  } catch {
    // Non-fatal
  }
}

function isWithinCooldown(isoDate: string | null, nowMs: number, cooldownMs: number): boolean {
  if (!isoDate) return false;
  const thenMs = Date.parse(isoDate);
  if (!Number.isFinite(thenMs)) return false;
  return nowMs - thenMs < cooldownMs;
}

function getLocalDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function getNotNowCooldownMs(dismissCount: number): number {
  if (dismissCount <= 1) return REVIEW_PROMPT_NOT_NOW_BASE_COOLDOWN_MS;
  if (dismissCount === 2) return REVIEW_PROMPT_NOT_NOW_SECOND_COOLDOWN_MS;
  return REVIEW_PROMPT_NOT_NOW_MAX_COOLDOWN_MS;
}

function getRemainingNotNowCooldownMs(now: Date, state: ReviewPromptState): number {
  if (!state.lastDismissedAt || state.dismissCount <= 0) return 0;
  const lastDismissedMs = Date.parse(state.lastDismissedAt);
  if (!Number.isFinite(lastDismissedMs)) return 0;
  const cooldownMs = getNotNowCooldownMs(state.dismissCount);
  return Math.max(0, lastDismissedMs + cooldownMs - now.getTime());
}

function getPromptsShownToday(now: Date, state: ReviewPromptState): number {
  const dayKey = getLocalDayKey(now);
  if (state.lastPromptDay !== dayKey) return 0;
  return state.promptsShownToday;
}

function hasReachedDailyPromptCap(now: Date, state: ReviewPromptState): boolean {
  return getPromptsShownToday(now, state) >= REVIEW_PROMPT_MAX_PROMPTS_PER_DAY;
}

function formatCooldownForDebug(ms: number): string {
  if (ms <= 0) return "0m";
  const roundedMinutes = Math.ceil(ms / (60 * 1000));
  if (roundedMinutes < 60) return roundedMinutes + "m";
  const roundedHours = Math.ceil(roundedMinutes / 60);
  return roundedHours + "h";
}

function isReviewPromptEligible(now: Date, state: ReviewPromptState): boolean {
  const nowMs = now.getTime();
  if (!state.firstSuccessfulScanAt) return false;
  if (isWithinCooldown(state.lastReviewVisitAt, nowMs, REVIEW_PROMPT_POST_REVIEW_COOLDOWN_MS)) return false;
  if (hasReachedDailyPromptCap(now, state)) return false;
  if (getRemainingNotNowCooldownMs(now, state) > 0) return false;
  return true;
}

function persistReviewPromptState(): void {
  saveReviewPromptState(reviewPromptState).catch(function () {
    // Non-fatal
  });
}

function markPromptShown(now: Date): void {
  const dayKey = getLocalDayKey(now);
  const nextPromptsToday = reviewPromptState.lastPromptDay === dayKey
    ? reviewPromptState.promptsShownToday + 1
    : 1;
  reviewPromptState = {
    ...reviewPromptState,
    lastPromptAt: now.toISOString(),
    lastPromptDay: dayKey,
    promptsShownToday: nextPromptsToday,
    promptCount: reviewPromptState.promptCount + 1,
  };
  persistReviewPromptState();
}

function markDismissed(now: Date): void {
  reviewPromptState = {
    ...reviewPromptState,
    lastDismissedAt: now.toISOString(),
    dismissCount: reviewPromptState.dismissCount + 1,
  };
  persistReviewPromptState();
}

function markReviewClicked(now: Date): void {
  reviewPromptState = {
    ...reviewPromptState,
    lastReviewVisitAt: now.toISOString(),
    dismissCount: 0,
  };
  persistReviewPromptState();
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
    const resolved = minViews && minViews > 0 ? minViews : DEFAULT_MIN_VIEWS;
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
    if (raw === null) return 100;
    if (raw === "all") return null;
    const val = parseInt(raw, 10);
    if (!Number.isFinite(val) || val <= 0) return 100;
    return normalizeScanLimit(val);
  } catch {
    return 100;
  }
}

function saveScanLimit(limit: number | null): void {
  try {
    if (limit === null) {
      localStorage.setItem(SCAN_LIMIT_KEY, "all");
    } else {
      localStorage.setItem(SCAN_LIMIT_KEY, String(normalizeScanLimit(limit)));
    }
  } catch {
    // Non-fatal
  }
}

function syncScanLimitUI(limit: number | null): void {
  const normalized = normalizeScanLimit(limit);
  scanLimitSlider.value = String(scanLimitToSliderPosition(normalized));
  scanLimitValue.textContent = formatScanLimitValue(normalized);
  scanLimitSlider.setAttribute("aria-valuetext", formatScanLimitValue(normalized));
  paintRange(scanLimitSlider);
}

function getScanLimitFromUI(): number | null {
  const position = getRangeValue(scanLimitSlider);
  return sliderPositionToScanLimit(position);
}

function setScanLimitControlsDisabled(disabled: boolean): void {
  scanLimitSlider.disabled = disabled;
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
    return normalizeMinViews(num);
  } catch {
    return null;
  }
}

function saveMinViews(minViews: number | null): void {
  try {
    if (minViews == null) {
      localStorage.removeItem(MIN_VIEWS_KEY);
    } else {
      localStorage.setItem(MIN_VIEWS_KEY, String(normalizeMinViews(minViews)));
    }
  } catch {
    // Non-fatal
  }
}

function resolveMinViewsForRun(): number {
  if (selectedMinViews && selectedMinViews > 0) {
    return normalizeMinViews(selectedMinViews) ?? DEFAULT_MIN_VIEWS;
  }
  return sliderPositionToMinViews(getRangeValue(minViewsSlider));
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
  const normalized = normalizeMinViews(minViews);
  selectedMinViews = normalized;
  const resolved = normalized ?? DEFAULT_MIN_VIEWS;
  minViewsSlider.value = String(minViewsToSliderPosition(resolved));
  minViewsValue.textContent = formatExact(resolved) + " views";
  minViewsSlider.setAttribute("aria-valuetext", formatExact(resolved) + " views");
  paintRange(minViewsSlider);
}

function setFilterControlsDisabled(disabled: boolean): void {
  for (let i = 0; i < filterModeBtns.length; i++) {
    filterModeBtns[i]!.disabled = disabled;
  }
  minViewsSlider.disabled = disabled || selectedFilterMode !== "minViews";
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
  const minViews = normalizeMinViews(
    Number.isFinite(raw.minViews) && (raw.minViews ?? 0) > 0 ? raw.minViews : null
  );
  const followers = raw.followers && raw.followers > 0 ? raw.followers : null;
  const threshold = Number.isFinite(raw.threshold) && (raw.threshold ?? 0) > 0
    ? raw.threshold
    : mode === "ratio5x" && followers
      ? followers * 5
      : minViews;

  const activeThresholdLabel = raw.activeThresholdLabel
    ? raw.activeThresholdLabel
    : getThresholdLabel(mode, followers, minViews);

  const phase = raw.phase === "analyzing" || raw.phase === "rendered" || raw.phase === "scanning"
    ? raw.phase
    : raw.status === "done"
      ? "rendered"
      : "scanning";

  return {
    ...raw,
    phase,
    filterMode: mode,
    minViews: minViews,
    threshold: threshold ?? null,
    activeThresholdLabel,
  };
}

// ── UI rendering ──────────────────────────────────────────────────────────
function showStats(thresholdLabel: string): void {
  clearElement(statsArea);
  const box = document.createElement("div");
  box.className = "stats";

  const row = document.createElement("div");
  row.className = "stat-row";
  const label = document.createElement("span");
  label.className = "stat-label";
  label.textContent = "Active threshold";
  const value = document.createElement("span");
  value.className = "stat-value threshold";
  value.textContent = thresholdLabel;
  row.appendChild(label);
  row.appendChild(value);

  box.appendChild(row);
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

function hideReviewPrompt(): void {
  reviewPromptEl.style.display = "none";
}

function showReviewPrompt(): void {
  reviewPromptEl.style.display = "flex";
}

function ensureFirstSuccessfulScanRecorded(now: Date): void {
  if (reviewPromptState.firstSuccessfulScanAt) return;
  reviewPromptState = {
    ...reviewPromptState,
    firstSuccessfulScanAt: now.toISOString(),
  };
  persistReviewPromptState();
}

function updateReviewPromptVisibility(state: OutliersState | null): void {
  if (activePanelView !== "outliers") {
    setReviewPromptDebug("blocked (not in Outliers view)");
    hideReviewPrompt();
    return;
  }

  // Dev mode lets you quickly force the modal on/off without clearing storage.
  if (reviewPromptDevMode === "forceOff") {
    clearReviewPromptDelayState();
    setReviewPromptDebug("forced OFF by dev mode");
    hideReviewPrompt();
    return;
  }
  if (reviewPromptDevMode === "forceOn") {
    clearReviewPromptDelayState();
    setReviewPromptDebug("forced ON by dev mode");
    showReviewPrompt();
    return;
  }

  // Show review ask only after a meaningful 5x success, not min-views mode.
  if (
    !state ||
    state.status !== "done" ||
    state.filterMode !== "ratio5x" ||
    state.outliers.length < REVIEW_PROMPT_MIN_OUTLIERS
  ) {
    const stateLabel = state ? state.status : "no state";
    const modeLabel = state ? state.filterMode : "n/a";
    const outlierCount = state ? state.outliers.length : 0;
    setReviewPromptDebug(
      "blocked (status=" + stateLabel + ", mode=" + modeLabel + ", outliers=" + outlierCount + ")"
    );
    clearReviewPromptDelayState();
    hideReviewPrompt();
    return;
  }

  if (reviewPromptClosedThisSession) {
    clearReviewPromptDelayState();
    setReviewPromptDebug("blocked (already closed in this session)");
    hideReviewPrompt();
    return;
  }

  const now = new Date();
  // Record the first qualifying success so eligibility is deterministic across reopen/reload.
  ensureFirstSuccessfulScanRecorded(now);

  if (reviewPromptShownThisSession) {
    clearReviewPromptDelayState();
    setReviewPromptDebug("showing (already shown this session)");
    showReviewPrompt();
    return;
  }

  if (!isReviewPromptEligible(now, reviewPromptState)) {
    clearReviewPromptDelayState();
    if (isWithinCooldown(reviewPromptState.lastReviewVisitAt, now.getTime(), REVIEW_PROMPT_POST_REVIEW_COOLDOWN_MS)) {
      setReviewPromptDebug("blocked (30-day cooldown after review visit)");
    } else if (hasReachedDailyPromptCap(now, reviewPromptState)) {
      setReviewPromptDebug("blocked (daily prompt cap reached)");
    } else if (getRemainingNotNowCooldownMs(now, reviewPromptState) > 0) {
      const remaining = getRemainingNotNowCooldownMs(now, reviewPromptState);
      setReviewPromptDebug("blocked (Not now cooldown " + formatCooldownForDebug(remaining) + " left)");
    } else {
      setReviewPromptDebug("blocked (not eligible)");
    }
    hideReviewPrompt();
    return;
  }

  if (reviewPromptEligibleSinceMs == null) {
    reviewPromptEligibleSinceMs = now.getTime();
  }

  const elapsedMs = now.getTime() - reviewPromptEligibleSinceMs;
  if (elapsedMs < REVIEW_PROMPT_DELAY_MS) {
    const remainingMs = REVIEW_PROMPT_DELAY_MS - elapsedMs;
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    setReviewPromptDebug("waiting " + remainingSeconds + "s before showing");
    scheduleReviewPromptDelayRefresh(remainingMs);
    hideReviewPrompt();
    return;
  }

  clearReviewPromptDelayState();
  setReviewPromptDebug("eligible (auto, delay complete)");
  showReviewPrompt();
  reviewPromptShownThisSession = true;
  markPromptShown(now);
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

function getShareableState(): OutliersState | null {
  if (!currentRenderedState || currentRenderedState.outliers.length === 0) return null;
  return currentRenderedState;
}

function setShareButtonsEnabled(enabled: boolean): void {
  copyOutliersBtn.disabled = !enabled;
  shareOutliersBtn.disabled = !enabled;
}

function formatOutlierLine(reel: OutliersEntry, rank: number): string {
  return "#" + rank + " | " + formatCount(reel.views) + " views | " + reel.ratio.toFixed(1) + "x";
}

function buildOutliersPlainText(state: OutliersState, limit: number | null = null): string {
  const outliers = limit == null ? state.outliers : state.outliers.slice(0, Math.max(0, limit));
  const profileLabel = lastKnownProfile ? lastKnownProfile.replace(/^\//, "@") : "profile";
  const lines: string[] = [];
  lines.push("Outliers report for " + profileLabel + " (" + state.activeThresholdLabel + ")");
  lines.push("");
  for (let i = 0; i < outliers.length; i++) {
    const reel = outliers[i]!;
    lines.push(formatOutlierLine(reel, i + 1));
    lines.push(reel.url);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function buildShareCaption(state: OutliersState): string {
  const profileLabel = lastKnownProfile ? lastKnownProfile.replace(/^\//, "@") : "this profile";
  const top = state.outliers.slice(0, 5);
  const lines: string[] = [];
  lines.push("Outliers portfolio for " + profileLabel);
  lines.push("Threshold: " + state.activeThresholdLabel);
  lines.push("");
  for (let i = 0; i < top.length; i++) {
    lines.push(formatOutlierLine(top[i]!, i + 1));
  }
  lines.push("");
  lines.push("Built with Outliers extension.");
  return lines.join("\n");
}

function buildTopLinksText(state: OutliersState): string {
  return state.outliers.slice(0, 5).map(function (r) {
    return r.url;
  }).join("\n");
}

function copyTextWithStatus(text: string, successMessage: string): void {
  navigator.clipboard.writeText(text).then(function () {
    statusEl.textContent = successMessage;
    statusEl.className = "status-msg";
  }).catch(function () {
    statusEl.textContent = "Copy failed. Please try again.";
    statusEl.className = "status-msg error";
  });
}

function openShareModal(): void {
  shareModalEl.style.display = "flex";
}

function closeShareModal(): void {
  shareModalEl.style.display = "none";
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise(function (resolve) {
    canvas.toBlob(function (blob) {
      resolve(blob);
    }, type);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      const out = reader.result;
      if (typeof out === "string") resolve(out);
      else reject(new Error("Failed to convert blob to data URL."));
    };
    reader.onerror = function () {
      reject(new Error("Failed to read blob."));
    };
    reader.readAsDataURL(blob);
  });
}

function drawTruncatedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
): void {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  let output = text;
  while (output.length > 1 && ctx.measureText(output + "…").width > maxWidth) {
    output = output.slice(0, -1);
  }
  ctx.fillText(output + "…", x, y);
}

async function remoteUrlToBitmap(imageUrl: string): Promise<{ bitmap: ImageBitmap | null; error?: string }> {
  try {
    const response = await fetch(imageUrl, { credentials: "omit", cache: "force-cache" });
    if (!response.ok) {
      return { bitmap: null, error: "Image fetch failed with status " + response.status + "." };
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    return { bitmap };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { bitmap: null, error: "Image fetch failed: " + message };
  }
}

interface ReelThumbLookupRow {
  href: string;
  imageUrl: string | null;
  source: "img" | "background" | null;
  reason?: string;
}

interface ReelThumbCaptureFailure {
  rank: number;
  href: string;
  reason: string;
}

async function lookupTopOutlierThumbnailUrls(
  tabId: number,
  top: OutliersEntry[]
): Promise<{ rows: ReelThumbLookupRow[]; failures: ReelThumbCaptureFailure[] }> {
  const targetHrefs = top.map(function (reel) {
    return reel.href;
  });

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      args: [targetHrefs],
      func: function (): ReelThumbLookupRow[] {
        const requestedHrefs = (arguments[0] as string[] | undefined) ?? [];
        const REEL_LINK_SELECTOR = 'a[href*="/reel/"], a[href*="/reels/"]';

        function normalizeHref(href: string | null | undefined): string | null {
          if (!href) return null;
          try {
            const u = new URL(href, window.location.origin);
            return u.pathname.replace(/\/+$/, "") || "/";
          } catch {
            return null;
          }
        }

        function absolutize(url: string | null): string | null {
          if (!url) return null;
          try {
            return new URL(url, window.location.origin).href;
          } catch {
            return null;
          }
        }

        function pickFirstSrcsetUrl(srcset: string | null): string | null {
          if (!srcset) return null;
          const first = srcset.split(",")[0]?.trim() ?? "";
          if (!first) return null;
          const firstUrl = first.split(/\s+/)[0]?.trim() ?? "";
          return firstUrl || null;
        }

        function extractCssUrl(backgroundImage: string): string | null {
          if (!backgroundImage || backgroundImage === "none") return null;
          const m = backgroundImage.match(/url\((['"]?)(.*?)\1\)/i);
          if (!m || !m[2]) return null;
          return m[2];
        }

        function readImageUrl(anchor: HTMLAnchorElement): string | null {
          const direct = anchor.querySelector("img") as HTMLImageElement | null;
          const parent = (anchor.closest("article, li, [role='presentation']") as HTMLElement | null)
            ?? (anchor.parentElement as HTMLElement | null);
          const candidate = direct ?? (parent ? (parent.querySelector("img") as HTMLImageElement | null) : null);
          if (!candidate) return null;
          const current = (candidate.currentSrc ?? "").trim();
          if (current) return current;
          const src = (candidate.getAttribute("src") ?? "").trim();
          if (src) return absolutize(src);
          return absolutize(pickFirstSrcsetUrl(candidate.getAttribute("srcset")));
        }

        function readBackgroundImageUrl(anchor: HTMLAnchorElement): string | null {
          const parent = (anchor.closest("article, li, [role='presentation']") as HTMLElement | null)
            ?? (anchor.parentElement as HTMLElement | null);
          const roots: HTMLElement[] = [anchor];
          if (parent && parent !== anchor) roots.push(parent);

          for (let ri = 0; ri < roots.length; ri++) {
            const root = roots[ri]!;
            const ownBg = extractCssUrl(window.getComputedStyle(root).backgroundImage);
            const ownResolved = absolutize(ownBg);
            if (ownResolved) return ownResolved;

            const nodes = root.querySelectorAll("div, span, picture");
            const limit = Math.min(nodes.length, 260);
            for (let i = 0; i < limit; i++) {
              const el = nodes[i] as HTMLElement;
              const rect = el.getBoundingClientRect();
              if (rect.width < 36 || rect.height < 36) continue;
              const bg = extractCssUrl(window.getComputedStyle(el).backgroundImage);
              const resolved = absolutize(bg);
              if (resolved) return resolved;
            }
          }

          return null;
        }

        const anchors = Array.from(document.querySelectorAll(REEL_LINK_SELECTOR)) as HTMLAnchorElement[];
        const rows: ReelThumbLookupRow[] = [];

        for (let i = 0; i < requestedHrefs.length; i++) {
          const requestedHref = requestedHrefs[i]!;
          const normalizedRequested = normalizeHref(requestedHref);
          const exactMatches: HTMLAnchorElement[] = [];
          const normalizedMatches: HTMLAnchorElement[] = [];

          for (let ai = 0; ai < anchors.length; ai++) {
            const anchor = anchors[ai]!;
            const rawHref = anchor.getAttribute("href");
            if (!rawHref) continue;
            const normalized = normalizeHref(rawHref);
            if (rawHref === requestedHref) exactMatches.push(anchor);
            if (normalizedRequested != null && normalized === normalizedRequested) normalizedMatches.push(anchor);
          }

          const candidates = (exactMatches.length > 0 ? exactMatches : normalizedMatches).sort(function (a, b) {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return rb.width * rb.height - ra.width * ra.height;
          });

          if (candidates.length === 0) {
            rows.push({
              href: requestedHref,
              imageUrl: null,
              source: null,
              reason: "No matching reel tile anchor found in page.",
            });
            continue;
          }

          let found: ReelThumbLookupRow | null = null;
          let debug = "";
          for (let ci = 0; ci < candidates.length; ci++) {
            const anchor = candidates[ci]!;
            const imgUrl = readImageUrl(anchor);
            if (imgUrl) {
              found = { href: requestedHref, imageUrl: imgUrl, source: "img" };
              break;
            }

            const bgUrl = readBackgroundImageUrl(anchor);
            if (bgUrl) {
              found = { href: requestedHref, imageUrl: bgUrl, source: "background" };
              break;
            }

            if (debug.length < 180) {
              const rect = anchor.getBoundingClientRect();
              debug += "[c" + (ci + 1) + " " + Math.round(rect.width) + "x" + Math.round(rect.height) + "] ";
            }
          }

          rows.push(
            found ?? {
              href: requestedHref,
              imageUrl: null,
              source: null,
              reason: "No image URL in matched tile candidates. " + debug.trim(),
            }
          );
        }

        return rows;
      },
    });

    const rows = (injected as unknown as Array<{ result?: ReelThumbLookupRow[] }>)?.[0]?.result;
    const safeRows = Array.isArray(rows) ? rows : [];
    const failures: ReelThumbCaptureFailure[] = [];

    for (let i = 0; i < top.length; i++) {
      const reel = top[i]!;
      const row = safeRows.find(function (r) {
        return r.href === reel.href;
      });
      if (!row || !row.imageUrl) {
        failures.push({
          rank: i + 1,
          href: reel.href,
          reason: row?.reason ?? "No thumbnail URL returned by page extractor.",
        });
      }
    }

    return { rows: safeRows, failures };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      rows: [],
      failures: top.map(function (reel, i) {
        return {
          rank: i + 1,
          href: reel.href,
          reason: "Thumbnail URL extraction failed: " + message,
        };
      }),
    };
  }
}

interface StoryCardBuildResultSuccess {
  ok: true;
  blob: Blob;
  filename: string;
}

interface StoryCardBuildResultFailure {
  ok: false;
  reason: string;
  failures: ReelThumbCaptureFailure[];
}

type StoryCardBuildResult = StoryCardBuildResultSuccess | StoryCardBuildResultFailure;

async function buildStoryCardBlob(state: OutliersState): Promise<StoryCardBuildResult> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { ok: false, reason: "Could not create story card canvas.", failures: [] };
  }

  statusEl.textContent = "Preparing story card preview…";
  statusEl.className = "status-msg";

  const top = state.outliers.slice(0, 5);
  const tabId = cachedTabId ?? (await getActiveTabId());
  if (tabId == null) {
    return { ok: false, reason: "No active Instagram tab found.", failures: [] };
  }

  statusEl.textContent = "Reading thumbnail URLs…";
  statusEl.className = "status-msg";

  const lookup = await lookupTopOutlierThumbnailUrls(tabId, top);
  const failures = lookup.failures.slice();
  const rowByHref = new Map<string, ReelThumbLookupRow>();
  for (let i = 0; i < lookup.rows.length; i++) {
    const row = lookup.rows[i]!;
    rowByHref.set(row.href, row);
  }

  const thumbnails: ImageBitmap[] = [];
  for (let i = 0; i < top.length; i++) {
    const reel = top[i]!;
    const row = rowByHref.get(reel.href);
    if (!row || !row.imageUrl) {
      if (!failures.some(function (f) { return f.href === reel.href; })) {
        failures.push({
          rank: i + 1,
          href: reel.href,
          reason: row?.reason ?? "No thumbnail URL resolved.",
        });
      }
      continue;
    }

    statusEl.textContent = "Loading thumbnails… " + (i + 1) + "/" + top.length;
    statusEl.className = "status-msg";

    const fetched = await remoteUrlToBitmap(row.imageUrl);
    if (!fetched.bitmap) {
      failures.push({
        rank: i + 1,
        href: reel.href,
        reason: (fetched.error ?? "Unknown image fetch failure.") + " source=" + row.source,
      });
      continue;
    }

    thumbnails.push(fetched.bitmap);
  }

  if (failures.length > 0 || thumbnails.length !== top.length) {
    for (let i = 0; i < thumbnails.length; i++) {
      thumbnails[i]?.close();
    }
    return {
      ok: false,
      reason: "Failed to resolve all story thumbnails.",
      failures,
    };
  }

  try {
    // High-contrast vertical canvas for quick Instagram Story uploads.
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#0a1024");
    gradient.addColorStop(0.5, "#111b3b");
    gradient.addColorStop(1, "#121e40");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(125, 211, 252, 0.12)";
    drawRoundedRect(ctx, 740, -120, 480, 480, 240);
    ctx.fill();
    ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
    drawRoundedRect(ctx, -110, 1410, 420, 420, 210);
    ctx.fill();

    const profileLabel = lastKnownProfile ? lastKnownProfile.replace(/^\//, "@") : "@profile";
    const followersLabel = state.followers ? formatCount(state.followers) + " followers" : "Followers unavailable";
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    drawRoundedRect(ctx, 70, 86, 940, 88, 22);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 52px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
    drawTruncatedText(ctx, profileLabel, 96, 145, 600);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "700 30px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
    const followersWidth = ctx.measureText(followersLabel).width;
    ctx.fillText(followersLabel, 980 - followersWidth, 145);

    const cardX = 70;
    const cardW = 940;
    const cardH = 312;
    const thumbX = cardX + 24;
    const thumbW = 208;
    const thumbH = 272;
    let y = 190;
    for (let i = 0; i < top.length; i++) {
      const reel = top[i]!;
      const bitmap = thumbnails[i]!;

      ctx.fillStyle = "rgba(255,255,255,0.08)";
      drawRoundedRect(ctx, cardX, y, cardW, cardH, 24);
      ctx.fill();
      ctx.strokeStyle = "rgba(186, 230, 253, 0.22)";
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, cardX, y, cardW, cardH, 24);
      ctx.stroke();

      ctx.save();
      drawRoundedRect(ctx, thumbX, y + 18, thumbW, thumbH, 16);
      ctx.clip();
      const srcW = bitmap.width;
      const srcH = bitmap.height;
      const srcRatio = srcW / srcH;
      const dstRatio = thumbW / thumbH;
      let sx = 0;
      let sy = 0;
      let sw = srcW;
      let sh = srcH;
      if (srcRatio > dstRatio) {
        sw = srcH * dstRatio;
        sx = (srcW - sw) / 2;
      } else {
        sh = srcW / dstRatio;
        sy = (srcH - sh) / 2;
      }
      ctx.drawImage(bitmap, sx, sy, sw, sh, thumbX, y + 18, thumbW, thumbH);
      ctx.restore();

      ctx.fillStyle = "#ffffff";
      ctx.font = "800 50px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
      ctx.fillText(formatCount(reel.views) + " views", cardX + 256, y + 90);

      ctx.fillStyle = "#dbeafe";
      ctx.font = "700 34px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
      ctx.fillText(reel.ratio.toFixed(1) + "x follower reach", cardX + 256, y + 152);

      ctx.fillStyle = "#cbd5e1";
      ctx.font = "500 24px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
      const shortUrl = reel.url.replace(/^https?:\/\//, "").slice(0, 56);
      ctx.fillText(shortUrl, cardX + 256, y + 214);
      y += 324;
    }

    ctx.fillStyle = "#93c5fd";
    ctx.font = "600 20px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
    ctx.fillText("Generated with Outliers extension", 70, 1860);

    const blob = await canvasToBlob(canvas, "image/png");
    if (!blob) {
      return { ok: false, reason: "Could not export story card blob.", failures: [] };
    }

    return {
      ok: true,
      blob,
      filename: "outliers_story_card_" + getLocalTimestampForFilename() + ".png",
    };
  } finally {
    for (let i = 0; i < thumbnails.length; i++) {
      thumbnails[i]?.close();
    }
  }
}

async function showStoryCardPreview(state: OutliersState): Promise<void> {
  if (storyCardGenerationInFlight) return;
  storyCardGenerationInFlight = true;
  shareDownloadStoryBtn.disabled = true;

  try {
    const result = await buildStoryCardBlob(state);
    if (!result.ok) {
      statusEl.textContent = "Story card preview failed. Open side panel console for details.";
      statusEl.className = "status-msg error";
      if (result.failures.length > 0) {
        console.error("[outliers] Story thumbnail capture failures:", result.failures);
      } else {
        console.error("[outliers] Story preview failure:", result.reason);
      }
      return;
    }
    const tabId = cachedTabId ?? (await getActiveTabId());
    if (tabId == null) {
      statusEl.textContent = "No active Instagram tab found to preview the story card.";
      statusEl.className = "status-msg error";
      return;
    }
    const dataUrl = await blobToDataUrl(result.blob);
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [dataUrl, result.filename],
      func: function (): void {
        const storyDataUrl = (arguments[0] as string | undefined) ?? "";
        const filename = (arguments[1] as string | undefined) ?? "outliers_story_card.png";
        if (!storyDataUrl) return;

        const ROOT_ID = "outliers-story-preview-root";
        const STYLE_ID = "outliers-story-preview-style";
        const EXISTING = document.getElementById(ROOT_ID);
        if (EXISTING) EXISTING.remove();

        const EXISTING_STYLE = document.getElementById(STYLE_ID);
        if (!EXISTING_STYLE) {
          const style = document.createElement("style");
          style.id = STYLE_ID;
          style.textContent = [
            "#" + ROOT_ID + " {",
            "  position: fixed;",
            "  inset: 0;",
            "  z-index: 2147483646;",
            "  background: rgba(2, 6, 23, 0.82);",
            "  display: flex;",
            "  align-items: center;",
            "  justify-content: center;",
            "  padding: 20px;",
            "}",
            "#" + ROOT_ID + " .outliers-story-wrap {",
            "  width: min(96vw, 860px);",
            "  max-height: 96vh;",
            "  display: flex;",
            "  flex-direction: column;",
            "  gap: 12px;",
            "}",
            "#" + ROOT_ID + " .outliers-story-actions {",
            "  display: flex;",
            "  justify-content: center;",
            "  gap: 10px;",
            "}",
            "#" + ROOT_ID + " .outliers-story-btn {",
            "  border: 1px solid rgba(255,255,255,0.28);",
            "  border-radius: 10px;",
            "  background: rgba(15, 23, 42, 0.8);",
            "  color: #fff;",
            "  padding: 9px 14px;",
            "  font: 700 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
            "  cursor: pointer;",
            "}",
            "#" + ROOT_ID + " .outliers-story-btn.primary {",
            "  background: #22c55e;",
            "  border-color: #16a34a;",
            "  color: #052e16;",
            "}",
            "#" + ROOT_ID + " .outliers-story-frame {",
            "  border-radius: 16px;",
            "  overflow: hidden;",
            "  background: #000;",
            "  box-shadow: 0 22px 50px rgba(0,0,0,0.45);",
            "}",
            "#" + ROOT_ID + " .outliers-story-image {",
            "  display: block;",
            "  width: 100%;",
            "  height: auto;",
            "  max-height: 84vh;",
            "  object-fit: contain;",
            "}",
          ].join("\n");
          document.head.appendChild(style);
        }

        const root = document.createElement("div");
        root.id = ROOT_ID;
        root.innerHTML = [
          '<div class="outliers-story-wrap">',
          '  <div class="outliers-story-actions">',
          '    <button class="outliers-story-btn primary" type="button" data-action="download">Download</button>',
          '    <button class="outliers-story-btn" type="button" data-action="close">Close</button>',
          "  </div>",
          '  <div class="outliers-story-frame">',
          '    <img class="outliers-story-image" alt="Story card preview" />',
          "  </div>",
          "</div>",
        ].join("");

        const img = root.querySelector(".outliers-story-image") as HTMLImageElement | null;
        if (img) img.src = storyDataUrl;

        function closePreview(): void {
          root.remove();
          document.removeEventListener("keydown", onKeyDown, true);
        }

        function onKeyDown(ev: KeyboardEvent): void {
          if (ev.key === "Escape") closePreview();
        }

        root.addEventListener("click", function (ev) {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          const action = target.getAttribute("data-action");
          if (action === "close" || ev.target === root) {
            closePreview();
            return;
          }
          if (action === "download") {
            const a = document.createElement("a");
            a.href = storyDataUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            closePreview();
          }
        });

        document.addEventListener("keydown", onKeyDown, true);
        document.body.appendChild(root);
      },
    });
    closeShareModal();
    statusEl.textContent = "Story card preview opened on the Instagram page.";
    statusEl.className = "status-msg";
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    statusEl.textContent = "Failed to open story preview on page: " + message;
    statusEl.className = "status-msg error";
  } finally {
    storyCardGenerationInFlight = false;
    shareDownloadStoryBtn.disabled = false;
  }
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
    setShareButtonsEnabled(false);
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
  setShareButtonsEnabled(true);
}

function hideResults(): void {
  resultsArea.style.display = "none";
  clearElement(resultsList);
  exportBtn.disabled = true;
  setShareButtonsEnabled(false);
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
  setShareButtonsEnabled(false);
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
    showStats(state.activeThresholdLabel);
  }

  switch (state.status) {
    case "idle":
      if (reviewPromptShownThisSession) reviewPromptClosedThisSession = true;
      hideProgress();
      hideResults();
      hideReviewPrompt();
      setButtonsForIdle();
      break;
    case "scanning":
      if (reviewPromptShownThisSession) reviewPromptClosedThisSession = true;
      setProgress(state.scannedCount, state.scanLimit);
      // Show progressively discovered outliers during scan instead of waiting for finalize.
      if (state.outliers.length > 0) {
        renderResults(state.outliers, state.scannedCount, state);
      } else {
        hideResults();
      }
      hideReviewPrompt();
      setButtonsForScanning();
      if (state.phase === "analyzing") {
        progressFill.style.width = "100%";
        progressFill.style.opacity = "0.6";
        progressFill.style.animation = "pulse 1.2s ease-in-out infinite";
        progressText.textContent = "Finalizing from collected reels…";
      }
      break;
    case "done":
      hideProgress();
      renderResults(state.outliers, state.scannedCount, state);
      updateReviewPromptVisibility(state);
      setButtonsForDone();
      if (state.outliers.length === 0) {
        statusEl.textContent =
          "No reels matched this filter. Click Reset to restore the native Instagram view.";
        statusEl.className = "status-msg";
      } else {
        statusEl.textContent = "";
        statusEl.className = "status-msg";
      }
      break;
    case "error":
      if (reviewPromptShownThisSession) reviewPromptClosedThisSession = true;
      hideProgress();
      hideResults();
      hideReviewPrompt();
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

  currentRenderedState = null;

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: readFollowersFromPage,
    });
    const followers = result?.[0]?.result ?? null;

    if (followers && followers > 0) {
      latestFollowers = followers;
      showStats(getThresholdLabel(selectedFilterMode, followers, selectedMinViews));
      runBtn.disabled = false;
      updateReviewPromptVisibility(currentRenderedState);
    } else {
      latestFollowers = null;
      showStats("—");
      runBtn.disabled = true;
      hideReviewPrompt();
    }
  } catch {
    latestFollowers = null;
    showStats("—");
    runBtn.disabled = true;
    hideReviewPrompt();
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
    if (reviewPromptShownThisSession) reviewPromptClosedThisSession = true;
    hideProgress();
    hideResults();
    hideReviewPrompt();
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

if (__OUTLIERS_WATCH__ && reviewDevModeBtn) {
  reviewDevModeBtn.addEventListener("click", function (ev) {
    ev.stopPropagation();
    cycleReviewPromptDevMode();
    updateReviewPromptVisibility(currentRenderedState);
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
    closeShareModal();
  }
});

reviewPromptDismissBtn.addEventListener("click", function () {
  const now = new Date();
  markDismissed(now);
  reviewPromptClosedThisSession = true;
  reviewPromptShownThisSession = false;
  clearReviewPromptDelayState();
  hideReviewPrompt();
});

reviewPromptRateBtn.addEventListener("click", function () {
  const now = new Date();
  markReviewClicked(now);
  reviewPromptClosedThisSession = true;
  reviewPromptShownThisSession = false;
  clearReviewPromptDelayState();
  hideReviewPrompt();
  window.open(REVIEW_URL, "_blank", "noopener,noreferrer");
});

copyOutliersBtn.addEventListener("click", function () {
  const state = getShareableState();
  if (!state) {
    statusEl.textContent = "No outliers available to copy yet.";
    statusEl.className = "status-msg error";
    return;
  }
  copyTextWithStatus(buildOutliersPlainText(state), "Outliers copied.");
});

shareOutliersBtn.addEventListener("click", function () {
  const state = getShareableState();
  if (!state) {
    statusEl.textContent = "Run a scan first to share outliers.";
    statusEl.className = "status-msg error";
    return;
  }
  openShareModal();
});

shareCloseBtn.addEventListener("click", closeShareModal);
shareModalEl.addEventListener("click", function (ev) {
  if (ev.target === shareModalEl) closeShareModal();
});

shareDownloadStoryBtn.addEventListener("click", function () {
  const state = getShareableState();
  if (!state) return;
  showStoryCardPreview(state);
});

shareCopyCaptionBtn.addEventListener("click", function () {
  const state = getShareableState();
  if (!state) return;
  copyTextWithStatus(buildShareCaption(state), "Share caption copied.");
});

shareCopyLinksBtn.addEventListener("click", function () {
  const state = getShareableState();
  if (!state) return;
  copyTextWithStatus(buildTopLinksText(state), "Top links copied.");
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
  reviewPromptShownThisSession = false;
  reviewPromptClosedThisSession = false;
  clearReviewPromptDelayState();
  hideReviewPrompt();
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
  statusEl.textContent = "Stopping scan and finalizing results…";
  statusEl.className = "status-msg";

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
});

resetBtn.addEventListener("click", async function () {
  setButtonsDisabled();
  clearReviewPromptDelayState();
  hideReviewPrompt();
  statusEl.textContent = "Resetting and reloading page…";
  statusEl.className = "status-msg";

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
  statusEl.textContent = "Waiting for page reload…";

  if (cachedTabId != null) {
    showLoading();
    window.setTimeout(function () {
      if (cachedTabId != null) {
        rehydrate(cachedTabId).catch(function () {
          // Tab may still be navigating — non-fatal
        });
      }
    }, 1500);
  }
});

scanLimitSlider.addEventListener("input", function () {
  const limit = sliderPositionToScanLimit(getRangeValue(scanLimitSlider));
  syncScanLimitUI(limit);
  saveScanLimit(limit);
});

for (let i = 0; i < filterModeBtns.length; i++) {
  filterModeBtns[i]!.addEventListener("click", function () {
    const mode = this.getAttribute("data-mode") === "minViews" ? "minViews" : "ratio5x";
    syncFilterModeUI(mode);
    if (mode === "minViews" && (!selectedMinViews || selectedMinViews <= 0)) {
      syncMinViewsUI(DEFAULT_MIN_VIEWS);
      saveMinViews(DEFAULT_MIN_VIEWS);
    }
    saveFilterMode(mode);
    setFilterControlsDisabled(false);

    if (currentRenderedState?.status !== "done") {
      showStats(getThresholdLabel(mode, latestFollowers, selectedMinViews));
    }
  });
}

minViewsSlider.addEventListener("input", function () {
  const minViews = sliderPositionToMinViews(getRangeValue(minViewsSlider));
  syncMinViewsUI(minViews);
  saveMinViews(minViews);
});

exportBtn.addEventListener("click", exportCurrentResults);

// ── Init ─────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  setHelpTooltipOpen(false);
  closeShareModal();
  switchPanelView("outliers");
  syncScanLimitUI(loadScanLimit());
  syncFilterModeUI(loadFilterMode());
  syncMinViewsUI(loadMinViews());
  setFilterControlsDisabled(false);
  if (__OUTLIERS_WATCH__) {
    // Dev-only review toggle is visible only in watch builds.
    reviewPromptDevMode = loadReviewPromptDevMode();
    if (reviewDevModeRow) reviewDevModeRow.style.display = "flex";
    if (reviewDevDebugEl) reviewDevDebugEl.style.display = "block";
    syncReviewPromptDevModeUI();
    setReviewPromptDebug("waiting for eligible 5x run");
  } else {
    reviewPromptDevMode = "auto";
    if (reviewDevModeRow) reviewDevModeRow.style.display = "none";
    if (reviewDevDebugEl) reviewDevDebugEl.style.display = "none";
  }
  reviewPromptState = await loadReviewPromptState();
  reviewPromptShownThisSession = false;
  reviewPromptClosedThisSession = false;
  clearReviewPromptDelayState();
  hideReviewPrompt();
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
