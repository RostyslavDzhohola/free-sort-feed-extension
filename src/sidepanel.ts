import { startHotReload } from "./hot-reload";
import { buildOutliersCsv, buildSavedCsv } from "./shared/export-csv";
import { buildEmptyStateCopy } from "./shared/empty-state-copy";
import { readProfileInfo, type ProfileInfo } from "./shared/read-profile";
import {
  TIKTOK_ORIGINS,
  detectPlatform,
  getProfileRef,
  getProfileUrlFromVideoUrl,
  isContentPermalink,
  platformName,
  profileKey,
  profileLabel,
  profileUrl,
  videoNoun,
  type ProfileRef,
} from "./shared/platform";
import {
  DEFAULT_MIN_VIEWS,
  formatCount,
  formatExact,
  formatMetricPhrase,
  formatMultiple,
  getThreshold,
  isFilterMode,
  isSortKey,
  metricValue,
  resolveSortKey,
  sortLabel,
  sortOptionsFor,
  viewsMultiple,
} from "./shared/videos";
import type {
  FilterMode,
  OutliersEntry,
  OutliersMessage,
  OutliersState,
  Platform,
  SavedReel,
  SortDir,
  SortKey,
  ViewSettings,
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
const sortKeySelect = document.getElementById("sort-key-select") as HTMLSelectElement;
const sortDirBtn = document.getElementById("sort-dir-btn") as HTMLButtonElement;
const resultsTitle = document.getElementById("results-title") as HTMLSpanElement;

// ── Local state ───────────────────────────────────────────────────────────
let cachedTabId: number | null = null;
let lastKnownUrl: string | null = null;
// profileKey() of the profile the bound tab shows, e.g. "tiktok:khaby.lame".
let lastKnownProfile: string | null = null;
let lastKnownProfileRef: ProfileRef | null = null;
let navPollTimer: number | null = null;
let navPollInFlight = false;
let panelWindowId: number | null = null;
// False until the panel has read a follower count or an active scan from the bound tab.
// While false, the navigation poll keeps retrying, so a cold or still-loading page
// becomes ready on its own instead of needing a refresh or a panel reopen.
let profileReady = false;
let profileWaitStartedAt: number | null = null;
let rehydrateInFlight = false;
// Bumped on every tab bind; async work captured under an older value must not touch the UI.
let bindGeneration = 0;
// Bumped whenever the bound tab starts or finishes loading a document. A rehydrate that
// straddles a reload may have read the old page, so its result is discarded.
let documentEpoch = 0;
let statsMessageKey: string | null = null;

let selectedFilterMode: FilterMode = "ratio5x";
let selectedMinViews: number | null = null;
let selectedSortKey: SortKey = "views";
let selectedSortDir: SortDir = "desc";
let currentRenderedState: OutliersState | null = null;
let latestFollowers: number | null = null;
// The platform the bound tab is on, once known; drives copy and the sort options.
let currentPlatform: Platform | null = null;
// The last profile read from the bound tab. Run needs its header and the scan tab.
let latestProfileInfo: ProfileInfo | null = null;
let hasTikTokAccess = false;
let viewPushTimer: number | null = null;
interface PendingViewPush {
  tabId: number;
  generation: number;
  epoch: number;
  view: ViewSettings;
  handle: string | null;
}
// The Show/Sort change waiting on viewPushTimer, with the tab, document and profile it was made for.
let pendingViewPush: PendingViewPush | null = null;
// Show/Sort writes sent to a page but not yet run there, per tab and bind. While any are out
// the controls are ahead of the page, so a rehydrate must not sync them from what it reads.
const viewWritesInFlight = new Map<string, number>();
// Per tab and bind, bumped on every Show/Sort edit and whenever a write to the page starts or
// finishes, so a rehydrate can tell its read overlapped one and may hold an outdated view.
const viewActivity = new Map<string, number>();
// Reset reloads the page; its "Waiting for page reload…" note clears once the profile is back.
let awaitingResetReload = false;
// Scan startups in progress, by tab: Run is injecting the scanner there. The controls hold the
// user's latest Show/Sort then, so a rehydrate of that tab that reads the scanner's first state
// must not pull them back. Keyed by tab, so another tab's rehydrate still syncs its own
// controls, a return to the tab mid-startup still finds it, and startups on two tabs coexist.
// `view` is the Show/Sort the scanner will start with: the latest edit made on that tab.
interface ScanStartup {
  tabId: number;
  view: ViewSettings;
}
const startingScans = new Map<number, ScanStartup>();
let activePanelView: "outliers" | "saved" = "outliers";
let helpTooltipOpen = false;
let reviewPromptState: ReviewPromptState = createDefaultReviewPromptState();
let reviewPromptShownThisSession = false;
let reviewPromptClosedThisSession = false;
let reviewPromptDelayTimer: number | null = null;
let reviewPromptDevMode: ReviewPromptDevMode = "auto";
let storyCardGenerationInFlight = false;

const savedByUrl = new Map<string, SavedReel>();

// ── Storage keys ──────────────────────────────────────────────────────────
const SCAN_LIMIT_KEY = "outliers_scan_limit";
const FILTER_MODE_KEY = "outliers_filter_mode";
const MIN_VIEWS_KEY = "outliers_min_views";
const SORT_KEY_KEY = "outliers_sort_key";
const SORT_DIR_KEY = "outliers_sort_dir";
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
// Keep activation broad: any finished scan with at least one result counts as a success.
const REVIEW_PROMPT_MIN_OUTLIERS = 1;
// On a later panel open, wait a moment so the ask doesn't land on top of loading.
const REVIEW_PROMPT_OPEN_DELAY_MS = 1_500;
// After this long without a follower count on a profile, stop showing the spinner and explain.
const PROFILE_WAIT_HINT_MS = 8_000;

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
  const noun = currentPlatform === "tiktok" ? "videos" : currentPlatform === "instagram" ? "Reels" : "videos";
  return limit === null ? "All " + noun : formatExact(limit) + " " + noun;
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

function clearReviewPromptDelayState(): void {
  if (reviewPromptDelayTimer == null) return;
  clearTimeout(reviewPromptDelayTimer);
  reviewPromptDelayTimer = null;
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
  if (mode === "all") return "All " + videoNoun(currentPlatform);
  const threshold = getThreshold(mode, followers, minViews);
  return threshold === null ? "5× follower count" : formatExact(threshold) + " views";
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
    const raw = localStorage.getItem(FILTER_MODE_KEY);
    return isFilterMode(raw) ? raw : "ratio5x";
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

function loadSort(): { key: SortKey; dir: SortDir } {
  try {
    const key = localStorage.getItem(SORT_KEY_KEY);
    const dir = localStorage.getItem(SORT_DIR_KEY);
    return { key: isSortKey(key) ? key : "views", dir: dir === "asc" ? "asc" : "desc" };
  } catch {
    return { key: "views", dir: "desc" };
  }
}

function saveSort(key: SortKey, dir: SortDir): void {
  try {
    localStorage.setItem(SORT_KEY_KEY, key);
    localStorage.setItem(SORT_DIR_KEY, dir);
  } catch {
    // Non-fatal
  }
}

/** The sort key shown for the current platform; a TikTok-only key falls back to views on Instagram. */
function effectiveSortKey(): SortKey {
  return resolveSortKey(selectedSortKey, currentPlatform);
}

function sortDirLabel(key: SortKey, dir: SortDir): { text: string; aria: string } {
  if (key === "date") {
    return dir === "desc"
      ? { text: "↓ Newest", aria: "Newest first" }
      : { text: "↑ Oldest", aria: "Oldest first" };
  }
  if (key === "duration") {
    return dir === "desc"
      ? { text: "↓ Longest", aria: "Longest first" }
      : { text: "↑ Shortest", aria: "Shortest first" };
  }
  return dir === "desc"
    ? { text: "↓ Highest", aria: "Highest first" }
    : { text: "↑ Lowest", aria: "Lowest first" };
}

// Rebuild the options when the platform changes: shares, saves, date and length are TikTok-only.
function syncSortUI(): void {
  const options = sortOptionsFor(currentPlatform);
  const wanted = options.map(function (o) {
    return o.key;
  }).join(",");
  if (sortKeySelect.getAttribute("data-options") !== wanted) {
    clearElement(sortKeySelect);
    for (let i = 0; i < options.length; i++) {
      const option = document.createElement("option");
      option.value = options[i]!.key;
      option.textContent = options[i]!.label;
      sortKeySelect.appendChild(option);
    }
    sortKeySelect.setAttribute("data-options", wanted);
  }
  const key = effectiveSortKey();
  sortKeySelect.value = key;
  const label = sortDirLabel(key, selectedSortDir);
  sortDirBtn.textContent = label.text;
  sortDirBtn.setAttribute("aria-label", label.aria);
  sortDirBtn.title = label.aria;
}

function currentView(): ViewSettings {
  return {
    filterMode: selectedFilterMode,
    minViews: resolveMinViewsForRun(),
    sortKey: effectiveSortKey(),
    sortDir: selectedSortDir,
  };
}

function resolveMinViewsForRun(): number {
  if (selectedMinViews && selectedMinViews > 0) {
    return normalizeMinViews(selectedMinViews) ?? DEFAULT_MIN_VIEWS;
  }
  return sliderPositionToMinViews(getRangeValue(minViewsSlider));
}

function syncFilterModeUI(mode: FilterMode): void {
  selectedFilterMode = mode;
  updateRunAvailability();
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

// Show and Sort by only reshape what was scanned, so they stay usable during and after a scan.
function setFilterControlsDisabled(disabled: boolean): void {
  for (let i = 0; i < filterModeBtns.length; i++) {
    filterModeBtns[i]!.disabled = disabled;
  }
  minViewsSlider.disabled = disabled || selectedFilterMode !== "minViews";
  sortKeySelect.disabled = disabled;
  sortDirBtn.disabled = disabled;
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
    profilePath: normalizeProfileUrl(currentProfileUrl(), reel.url),
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

    const primary = document.createElement("div");
    primary.className = "result-primary";
    primary.textContent = formatMetricPhrase("views", reel.views ?? null);

    const meta = document.createElement("div");
    meta.className = "saved-meta";
    const owner = reel.profilePath ? getProfileRef(reel.profilePath) : null;
    meta.textContent = (owner ? profileLabel(owner) + " · " : "") + platformName(reel.platform);

    info.appendChild(primary);
    info.appendChild(buildMetricChips(reel, null, "views"));
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

    row.appendChild(buildThumb(reel));
    row.appendChild(info);
    row.appendChild(actions);
    savedList.appendChild(row);
  }
}

// ── Result rows ───────────────────────────────────────────────────────────
const METRIC_ICONS: Record<string, string> = {
  views: "M8 5.5v13l10.5-6.5z",
  likes: "M12 20.5s-7.6-4.6-9.5-9.3C1.2 7.9 3.3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3 1.7-1.8 3.2-3 5.3-3 3.4 0 5.5 3.4 4.2 6.7-1.9 4.7-9.5 9.3-9.5 9.3z",
  comments: "M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.5L5 21v-3.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z",
  shares: "M13.5 5v4C6.5 9.6 4 14 3.5 19.5c2-3.2 4.8-4.6 10-4.6V19L21 12z",
  saves: "M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z",
};

function buildThumbPlaceholder(): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "result-thumb";
  placeholder.setAttribute("aria-hidden", "true");
  return placeholder;
}

function buildThumb(entry: OutliersEntry): HTMLElement {
  if (!entry.thumbnailUrl) return buildThumbPlaceholder();
  const img = document.createElement("img");
  img.className = "result-thumb";
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.src = entry.thumbnailUrl;
  // Signed CDN thumbnails expire; an old Library entry falls back to the plain tile.
  img.addEventListener("error", function () {
    img.replaceWith(buildThumbPlaceholder());
  });
  return img;
}

function metricChip(className: string, text: string, title: string, icon?: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "metric-chip " + className;
  chip.title = title;
  if (icon) {
    chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + icon + '"/></svg>';
  }
  chip.appendChild(document.createTextNode(text));
  return chip;
}

/** Every number we have for a video, with the one it's sorted by highlighted. */
function buildMetricChips(entry: OutliersEntry, followers: number | null, activeKey: SortKey): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "metric-chips";
  const platform = entry.platform ?? "instagram";
  const counts: SortKey[] = platform === "tiktok"
    ? ["views", "likes", "comments", "shares", "saves"]
    : ["views", "likes", "comments"];
  for (let i = 0; i < counts.length; i++) {
    const key = counts[i]!;
    const value = metricValue(entry, key, followers);
    const exact = value === null
      ? (key === "likes" && entry.likesHidden ? "Likes hidden by the creator" : "Not shown for this video")
      : formatExact(value) + " " + key;
    wrap.appendChild(metricChip(key === activeKey ? "active" : "", value === null ? "—" : formatCount(value), exact, METRIC_ICONS[key]));
  }
  const multiple = viewsMultiple(entry, followers);
  if (multiple !== null) {
    wrap.appendChild(metricChip("multiple" + (activeKey === "multiple" ? " active" : ""), formatMultiple(multiple), "Views ÷ followers"));
  }
  // The post date helps with every sort; the headline above already shows the sorted metric.
  const postedAt = metricValue(entry, "date", followers);
  if (postedAt !== null && activeKey !== "date") {
    wrap.appendChild(metricChip("", formatMetricPhrase("date", postedAt), sortLabel("date")));
  }
  return wrap;
}

// ── URL helpers ──────────────────────────────────────────────────────────
function normalizeProfileUrl(profilePathOrUrl: string | null, reelUrl?: string): string | null {
  if (reelUrl) {
    const fromReel = getProfileUrlFromVideoUrl(reelUrl);
    if (fromReel) return fromReel;
  }

  if (!profilePathOrUrl) return null;
  // Pre-release 1.1 builds stored the internal key, e.g. instagram.com/instagram:natgeo/.
  const fromKey = profilePathOrUrl.match(/^https?:\/\/[^/]+\/(instagram|tiktok):([^/?#]+)\/?$/i);
  if (fromKey) {
    return profileUrl({ platform: fromKey[1]!.toLowerCase() as Platform, handle: fromKey[2]!.toLowerCase() });
  }
  if (/^https?:\/\//i.test(profilePathOrUrl)) {
    if (detectPlatform(profilePathOrUrl) === "tiktok") return profilePathOrUrl.replace(/\/+$/, "");
    return profilePathOrUrl.endsWith("/") ? profilePathOrUrl : profilePathOrUrl + "/";
  }
  // 1.0.x stored Instagram profile paths like "/natgeo".
  if (profilePathOrUrl.startsWith("/")) {
    return "https://www.instagram.com" + profilePathOrUrl + (profilePathOrUrl.endsWith("/") ? "" : "/");
  }
  return "https://www.instagram.com/" + profilePathOrUrl.replace(/^@/, "") + "/";
}

function currentProfileUrl(): string | null {
  return lastKnownProfileRef ? profileUrl(lastKnownProfileRef) : null;
}

// ── State normalization ───────────────────────────────────────────────────
function normalizeState(raw: OutliersState): OutliersState {
  const mode: FilterMode = isFilterMode(raw.filterMode) ? raw.filterMode : "ratio5x";
  const minViews = normalizeMinViews(
    Number.isFinite(raw.minViews) && (raw.minViews ?? 0) > 0 ? raw.minViews : null
  );
  const followers = raw.followers && raw.followers > 0 ? raw.followers : null;
  const threshold = Number.isFinite(raw.threshold) && (raw.threshold ?? 0) > 0
    ? raw.threshold
    : getThreshold(mode, followers, minViews);

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
    sortKey: isSortKey(raw.sortKey) ? raw.sortKey : "views",
    sortDir: raw.sortDir === "asc" ? "asc" : "desc",
    threshold: threshold ?? null,
    activeThresholdLabel,
    outliers: Array.isArray(raw.outliers) ? raw.outliers : [],
  };
}

// ── UI rendering ──────────────────────────────────────────────────────────
function statRow(labelText: string, valueText: string, valueClass: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "stat-row";
  const label = document.createElement("span");
  label.className = "stat-label";
  label.textContent = labelText;
  const value = document.createElement("span");
  value.className = "stat-value " + valueClass;
  value.textContent = valueText;
  row.appendChild(label);
  row.appendChild(value);
  return row;
}

interface StatsHint {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

function showStats(thresholdLabel: string, hint?: StatsHint): void {
  // The poll re-renders every tick; rebuilding identical stats would eat clicks on the hint button.
  const key = "stats:" + [
    profileKey(lastKnownProfileRef),
    latestFollowers,
    selectedFilterMode,
    thresholdLabel,
    hint?.text ?? "",
    hint?.actionLabel ?? "",
  ].join("|");
  if (statsMessageKey === key) return;
  statsMessageKey = key;
  clearElement(statsArea);
  const box = document.createElement("div");
  box.className = "stats";

  if (lastKnownProfileRef) {
    box.appendChild(statRow(platformName(lastKnownProfileRef.platform), profileLabel(lastKnownProfileRef), "handle"));
    box.appendChild(statRow("Followers", latestFollowers ? formatExact(latestFollowers) : "—", "followers"));
  }
  box.appendChild(statRow(selectedFilterMode === "all" ? "Showing" : "Active threshold", thresholdLabel, "threshold"));

  if (hint) {
    const hintEl = document.createElement("div");
    hintEl.className = "stat-hint";
    hintEl.textContent = hint.text;
    box.appendChild(hintEl);
    if (hint.actionLabel && hint.onAction) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "stat-action";
      action.textContent = hint.actionLabel;
      action.addEventListener("click", hint.onAction);
      box.appendChild(action);
    }
  }
  statsArea.appendChild(box);
}

function showError(msg: string): void {
  statsMessageKey = null;
  clearElement(statsArea);
  const el = document.createElement("div");
  el.className = "status-msg error";
  el.textContent = msg;
  statsArea.appendChild(el);
}

function showLoading(): void {
  if (statsMessageKey === "loading") return;
  statsMessageKey = "loading";
  clearElement(statsArea);
  const wrapper = document.createElement("div");
  wrapper.className = "status-msg";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  wrapper.appendChild(spinner);
  wrapper.appendChild(document.createTextNode("Reading profile…"));
  statsArea.appendChild(wrapper);
}

function showNotice(msg: string, hint?: string): void {
  const offerTikTok = !hasTikTokAccess;
  const key = "notice:" + msg + ":" + (hint ?? "") + (offerTikTok ? ":tiktok" : "");
  if (statsMessageKey === key) return;
  statsMessageKey = key;
  clearElement(statsArea);
  const el = document.createElement("div");
  el.className = "status-msg";
  el.textContent = msg;
  statsArea.appendChild(el);
  if (hint) {
    const hintEl = document.createElement("div");
    hintEl.className = "stat-hint";
    hintEl.textContent = hint;
    statsArea.appendChild(hintEl);
  }
  if (offerTikTok) statsArea.appendChild(buildTikTokCard());
}

// TikTok access is optional, so updating Outliers never asks existing users to re-approve it.
function buildTikTokCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "platform-card";
  const title = document.createElement("div");
  title.className = "platform-card-title";
  title.textContent = "Scan TikTok profiles too";
  const body = document.createElement("p");
  body.textContent = "Outliers works on TikTok. Chrome will ask once to let it read tiktok.com; nothing leaves your browser.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Turn on TikTok";
  button.addEventListener("click", requestTikTokAccess);
  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(button);
  return card;
}

function requestTikTokAccess(): void {
  // permissions.request needs the click's user gesture, so nothing may be awaited before it.
  chrome.permissions.request({ origins: TIKTOK_ORIGINS }).then(function (granted) {
    hasTikTokAccess = granted;
    if (!granted) {
      statusEl.textContent = "TikTok stays off. You can turn it on here any time.";
      statusEl.className = "status-msg";
      return;
    }
    statusEl.textContent = "TikTok is on. Open a TikTok profile to scan it.";
    statusEl.className = "status-msg";
    statsMessageKey = null;
    if (cachedTabId != null) {
      bindToTab(cachedTabId).catch(function () {
        // Non-fatal
      });
    }
  }).catch(function () {
    statusEl.textContent = "Chrome couldn't turn on TikTok access. Please try again.";
    statusEl.className = "status-msg error";
  });
}

async function refreshTikTokAccess(): Promise<void> {
  try {
    hasTikTokAccess = await chrome.permissions.contains({ origins: TIKTOK_ORIGINS });
  } catch {
    hasTikTokAccess = false;
  }
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

  // Record the first finished scan with results so a later open or export can ask.
  if (state && state.status === "done" && state.outliers.length >= REVIEW_PROMPT_MIN_OUTLIERS) {
    ensureFirstSuccessfulScanRecorded(new Date());
  }

  if (state?.status === "scanning" || !reviewPromptShownThisSession || reviewPromptClosedThisSession) {
    hideReviewPrompt();
    return;
  }
  showReviewPrompt();
}

// The ask comes at a win (an export, a copy, a story card) or on a later panel open, never mid-scan.
function offerReviewPrompt(reason: string): void {
  if (reviewPromptDevMode !== "auto") return;
  if (reviewPromptShownThisSession || reviewPromptClosedThisSession) return;
  if (currentRenderedState?.status === "scanning") return;
  const now = new Date();
  if (!isReviewPromptEligible(now, reviewPromptState)) {
    if (isWithinCooldown(reviewPromptState.lastReviewVisitAt, now.getTime(), REVIEW_PROMPT_POST_REVIEW_COOLDOWN_MS)) {
      setReviewPromptDebug("blocked (30-day cooldown after review visit)");
    } else if (hasReachedDailyPromptCap(now, reviewPromptState)) {
      setReviewPromptDebug("blocked (daily prompt cap reached)");
    } else if (getRemainingNotNowCooldownMs(now, reviewPromptState) > 0) {
      const remaining = getRemainingNotNowCooldownMs(now, reviewPromptState);
      setReviewPromptDebug("blocked (Not now cooldown " + formatCooldownForDebug(remaining) + " left)");
    } else {
      setReviewPromptDebug("blocked (no finished scan yet)");
    }
    return;
  }
  reviewPromptShownThisSession = true;
  markPromptShown(now);
  setReviewPromptDebug("showing (" + reason + ")");
  showReviewPrompt();
}

function setProgress(scannedCount: number, scanLimit: number | null): void {
  progressArea.style.display = "block";
  const noun = videoNoun(currentPlatform);
  if (scanLimit !== null && scanLimit > 0) {
    const pct = Math.min(100, (scannedCount / scanLimit) * 100);
    progressFill.style.width = pct + "%";
    progressFill.style.opacity = "1";
    progressFill.style.animation = "";
    progressText.textContent = "Scanning… " + scannedCount + " / " + scanLimit + " " + noun;
  } else {
    progressFill.style.width = "100%";
    progressFill.style.opacity = "0.4";
    progressFill.style.animation = "pulse 1.5s ease-in-out infinite";
    progressText.textContent = "Scanning… " + scannedCount + " " + noun + " found";
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

// "#1 | 1.2K comments | 120K views | 4.5K likes | 12.4x", led by the metric the list is sorted by.
function formatOutlierLine(reel: OutliersEntry, rank: number, state: OutliersState): string {
  const sortKey = state.sortKey ?? "views";
  const parts = ["#" + rank, formatMetricPhrase(sortKey, metricValue(reel, sortKey, state.followers), reel.likesHidden)];
  const platform = reel.platform ?? "instagram";
  const others: SortKey[] = platform === "tiktok"
    ? ["views", "likes", "comments", "shares", "saves"]
    : ["views", "likes", "comments"];
  for (let i = 0; i < others.length; i++) {
    const key = others[i]!;
    if (key === sortKey) continue;
    const value = metricValue(reel, key, state.followers);
    if (value !== null) parts.push(formatMetricPhrase(key, value));
  }
  const multiple = viewsMultiple(reel, state.followers);
  if (multiple !== null && sortKey !== "multiple") parts.push(formatMultiple(multiple));
  return parts.join(" | ");
}

function describeView(state: OutliersState): string {
  const sortKey = state.sortKey ?? "views";
  return state.activeThresholdLabel + ", sorted by " + sortLabel(sortKey).toLowerCase()
    + (state.sortDir === "asc" ? " ↑" : " ↓");
}

function buildOutliersPlainText(state: OutliersState, limit: number | null = null): string {
  const outliers = limit == null ? state.outliers : state.outliers.slice(0, Math.max(0, limit));
  const label = profileLabel(lastKnownProfileRef);
  const lines: string[] = [];
  lines.push("Outliers report for " + label + " on " + platformName(state.platform) + " (" + describeView(state) + ")");
  lines.push("");
  for (let i = 0; i < outliers.length; i++) {
    const reel = outliers[i]!;
    lines.push(formatOutlierLine(reel, i + 1, state));
    lines.push(reel.url);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function buildShareCaption(state: OutliersState): string {
  const label = lastKnownProfileRef ? profileLabel(lastKnownProfileRef) : "this profile";
  const top = state.outliers.slice(0, 5);
  const lines: string[] = [];
  lines.push("Outliers portfolio for " + label + " on " + platformName(state.platform));
  lines.push("Showing: " + describeView(state));
  lines.push("");
  for (let i = 0; i < top.length; i++) {
    lines.push(formatOutlierLine(top[i]!, i + 1, state));
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
        const REEL_LINK_SELECTOR = 'a[href*="/reel/"], a[href*="/reels/"], a[href*="/video/"], a[href*="/photo/"]';

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
    return { ok: false, reason: "No active tab found.", failures: [] };
  }

  // Thumbnails captured during the scan come first; the page fills in any that are missing.
  const urlByHref = new Map<string, string>();
  const missing: OutliersEntry[] = [];
  for (let i = 0; i < top.length; i++) {
    const reel = top[i]!;
    if (reel.thumbnailUrl) urlByHref.set(reel.href, reel.thumbnailUrl);
    else missing.push(reel);
  }
  const failures: ReelThumbCaptureFailure[] = [];
  if (missing.length > 0) {
    statusEl.textContent = "Reading thumbnail URLs…";
    const lookup = await lookupTopOutlierThumbnailUrls(tabId, missing);
    for (let i = 0; i < lookup.rows.length; i++) {
      const row = lookup.rows[i]!;
      if (row.imageUrl) urlByHref.set(row.href, row.imageUrl);
    }
  }

  const thumbnails: Array<ImageBitmap | null> = [];
  for (let i = 0; i < top.length; i++) {
    const reel = top[i]!;
    const imageUrl = urlByHref.get(reel.href);
    statusEl.textContent = "Loading thumbnails… " + (i + 1) + "/" + top.length;
    if (!imageUrl) {
      failures.push({ rank: i + 1, href: reel.href, reason: "No thumbnail URL resolved." });
      thumbnails.push(null);
      continue;
    }
    const fetched = await remoteUrlToBitmap(imageUrl);
    if (!fetched.bitmap) {
      failures.push({ rank: i + 1, href: reel.href, reason: fetched.error ?? "Unknown image fetch failure." });
    }
    thumbnails.push(fetched.bitmap);
  }
  if (failures.length > 0) {
    // A missing cover gets a placeholder tile rather than sinking the whole card.
    console.warn("[outliers] Story thumbnails drawn as placeholders:", failures);
  }

  const FONT = "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
  const sortKey = state.sortKey ?? "views";
  try {
    // High-contrast vertical canvas for quick Instagram/TikTok Story uploads.
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#1a0b2e");
    gradient.addColorStop(0.55, "#2b1146");
    gradient.addColorStop(1, "#3a1352");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(249, 155, 33, 0.14)";
    drawRoundedRect(ctx, 740, -120, 480, 480, 240);
    ctx.fill();
    ctx.fillStyle = "rgba(179, 21, 239, 0.16)";
    drawRoundedRect(ctx, -110, 1410, 420, 420, 210);
    ctx.fill();

    const label = lastKnownProfileRef ? profileLabel(lastKnownProfileRef) : "@profile";
    const followersLabel = state.followers ? formatCount(state.followers) + " followers" : platformName(state.platform);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    drawRoundedRect(ctx, 70, 70, 940, 88, 22);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 52px " + FONT;
    drawTruncatedText(ctx, label, 96, 130, 600);
    ctx.fillStyle = "#e9d5ff";
    ctx.font = "700 30px " + FONT;
    const followersWidth = ctx.measureText(followersLabel).width;
    ctx.fillText(followersLabel, 980 - followersWidth, 130);

    ctx.fillStyle = "#fcd9a8";
    ctx.font = "800 30px " + FONT;
    ctx.fillText(storyHeading(sortKey, state.sortDir ?? "desc", top.length), 72, 205);

    const cardX = 70;
    const cardW = 940;
    const cardH = 300;
    const thumbX = cardX + 24;
    const thumbW = 200;
    const thumbH = 264;
    let y = 232;
    for (let i = 0; i < top.length; i++) {
      const reel = top[i]!;
      const bitmap = thumbnails[i] ?? null;

      ctx.fillStyle = "rgba(255,255,255,0.08)";
      drawRoundedRect(ctx, cardX, y, cardW, cardH, 24);
      ctx.fill();
      ctx.strokeStyle = "rgba(233, 213, 255, 0.22)";
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, cardX, y, cardW, cardH, 24);
      ctx.stroke();

      ctx.save();
      drawRoundedRect(ctx, thumbX, y + 18, thumbW, thumbH, 16);
      ctx.clip();
      if (bitmap) {
        const srcRatio = bitmap.width / bitmap.height;
        const dstRatio = thumbW / thumbH;
        let sx = 0;
        let sy = 0;
        let sw = bitmap.width;
        let sh = bitmap.height;
        if (srcRatio > dstRatio) {
          sw = bitmap.height * dstRatio;
          sx = (bitmap.width - sw) / 2;
        } else {
          sh = bitmap.width / dstRatio;
          sy = (bitmap.height - sh) / 2;
        }
        ctx.drawImage(bitmap, sx, sy, sw, sh, thumbX, y + 18, thumbW, thumbH);
      } else {
        const placeholder = ctx.createLinearGradient(thumbX, y, thumbX + thumbW, y + thumbH);
        placeholder.addColorStop(0, "#950acc");
        placeholder.addColorStop(1, "#f99b21");
        ctx.fillStyle = placeholder;
        ctx.fillRect(thumbX, y + 18, thumbW, thumbH);
      }
      ctx.restore();

      ctx.fillStyle = "#f99b21";
      ctx.font = "800 30px " + FONT;
      ctx.fillText("#" + (i + 1), cardX + 248, y + 62);

      ctx.fillStyle = "#ffffff";
      ctx.font = "800 50px " + FONT;
      drawTruncatedText(ctx, formatMetricPhrase(sortKey, metricValue(reel, sortKey, state.followers), reel.likesHidden), cardX + 248, y + 122, 660);

      const others: string[] = [];
      const keys: SortKey[] = ["views", "likes", "comments"];
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k]!;
        if (key === sortKey) continue;
        const value = metricValue(reel, key, state.followers);
        if (value !== null) others.push(formatMetricPhrase(key, value));
      }
      ctx.fillStyle = "#e9d5ff";
      ctx.font = "700 32px " + FONT;
      drawTruncatedText(ctx, others.join("  ·  "), cardX + 248, y + 180, 660);

      const multiple = viewsMultiple(reel, state.followers);
      ctx.fillStyle = "#cbb7e6";
      ctx.font = "600 26px " + FONT;
      const tail = multiple !== null && sortKey !== "multiple"
        ? formatMultiple(multiple) + " follower reach"
        : reel.url.replace(/^https?:\/\//, "");
      drawTruncatedText(ctx, tail, cardX + 248, y + 236, 660);
      y += 316;
    }

    ctx.fillStyle = "#d8b4fe";
    ctx.font = "600 22px " + FONT;
    ctx.fillText("Generated with Outliers, free Chrome extension", 70, 1860);

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

// "Top 5 by views", or "Lowest 5 by views" when the list runs lowest first.
function storyHeading(key: SortKey, dir: SortDir, count: number): string {
  let lead: string;
  if (key === "date") lead = dir === "desc" ? "Newest" : "Oldest";
  else if (key === "duration") lead = dir === "desc" ? "Longest" : "Shortest";
  else lead = dir === "desc" ? "Top" : "Lowest";
  return lead + " " + count + " by " + sortLabel(key).toLowerCase();
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
      statusEl.textContent = "No active tab found to preview the story card.";
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
    statusEl.textContent = "Story card preview opened on the " + platformName(state.platform) + " page.";
    statusEl.className = "status-msg";
    offerReviewPrompt("story card");
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
  const noun = videoNoun(state.platform ?? currentPlatform);
  resultsTitle.textContent = state.filterMode === "all"
    ? noun.charAt(0).toUpperCase() + noun.slice(1)
    : "Outliers";
  resultsMeta.textContent = "— " + outliers.length + " of " + scannedCount + " " + noun;
  clearElement(resultsList);
  const sortKey = state.sortKey ?? "views";

  if (outliers.length === 0) {
    const copy = buildEmptyStateCopy({
      platform: state.platform ?? currentPlatform,
      filterMode: state.filterMode,
      followers: state.followers,
      threshold: state.threshold,
      minViews: state.minViews,
      scanLimit: state.scanLimit,
      scannedCount: state.scannedCount,
    });
    const empty = document.createElement("div");
    empty.className = "empty-msg";
    const title = document.createElement("strong");
    title.textContent = copy.title;
    const detail = document.createElement("div");
    detail.textContent = copy.detail;
    empty.appendChild(title);
    empty.appendChild(document.createElement("br"));
    empty.appendChild(detail);
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
    const primary = document.createElement("div");
    primary.className = "result-primary";
    primary.textContent = formatMetricPhrase(sortKey, metricValue(reel, sortKey, state.followers), reel.likesHidden);
    info.appendChild(primary);
    info.appendChild(buildMetricChips(reel, state.followers, sortKey));

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
    item.appendChild(buildThumb(reel));
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
  stopBtn.style.display = "none";
  resetBtn.style.display = "none";
  setScanLimitControlsDisabled(false);
  setFilterControlsDisabled(false);
  updateRunAvailability();
}

function setButtonsForScanning(): void {
  runBtn.style.display = "none";
  stopBtn.style.display = "block";
  stopBtn.disabled = false;
  resetBtn.style.display = "none";
  setScanLimitControlsDisabled(true);
  setFilterControlsDisabled(false);
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

// syncControls: adopt the page's view settings (on rehydrate). Live updates leave the controls
// alone, so a reply to an earlier slider position can't pull the slider back mid-drag.
function renderState(rawState: OutliersState, syncControls = false): void {
  const state = normalizeState(rawState);
  currentRenderedState = state;
  if (state.followers && state.followers > 0) latestFollowers = state.followers;
  if (state.platform && state.platform !== currentPlatform) {
    currentPlatform = state.platform;
    syncSortUI();
    syncScanLimitUI(getScanLimitFromUI());
  }

  if (syncControls) {
    syncFilterModeUI(state.filterMode);
    if (state.minViews) syncMinViewsUI(state.minViews);
    if (state.sortKey) selectedSortKey = state.sortKey;
    if (state.sortDir) selectedSortDir = state.sortDir;
    syncSortUI();
    saveFilterMode(state.filterMode);
    if (state.minViews) saveMinViews(state.minViews);
    saveSort(selectedSortKey, selectedSortDir);
  }

  statusEl.textContent = "";
  statusEl.className = "status-msg";

  showStats(state.activeThresholdLabel);

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
        statusEl.textContent = "";
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

// ── Tab helpers ───────────────────────────────────────────────────────────
async function getActiveTabId(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? null;
  } catch {
    return null;
  }
}

function clearRenderedScan(): void {
  if (currentRenderedState == null) return;
  currentRenderedState = null;
  hideProgress();
  hideResults();
  hideReviewPrompt();
  setButtonsForIdle();
}

async function rehydrate(tabId: number): Promise<void> {
  // A rehydrate for a previous tab may still be in flight; its result is discarded, and the
  // poll retries for the new tab because profileReady stays false.
  if (rehydrateInFlight) return;
  rehydrateInFlight = true;
  try {
    await rehydrateOnce(tabId, bindGeneration, documentEpoch);
  } finally {
    rehydrateInFlight = false;
  }
}

async function rehydrateOnce(tabId: number, generation: number, epoch: number): Promise<void> {
  const isStale = function (): boolean {
    return !isStillBound(tabId, generation) || epoch !== documentEpoch;
  };
  // A read that began during Run's startup, or before the latest Show/Sort reached the page,
  // may return an older view; it must not overwrite the controls even if it lands later.
  const startedDuringStartup = isScanStarting(tabId);
  const activityAtStart = viewActivityOf(tabId, generation);
  let url: string | null = null;
  let errorText: string | null = null;
  try {
    const stateResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: function (): { state: OutliersState | null; url: string } {
        return {
          state: (window as unknown as { __outliers_state?: OutliersState }).__outliers_state ?? null,
          url: window.location.href,
        };
      },
    });
    if (isStale()) return;
    const payload = stateResult?.[0]?.result as { state: OutliersState | null; url: string } | undefined;
    url = payload?.url ?? null;
    adoptProfileFromUrl(url);
    const rawState = payload?.state ?? null;
    if (rawState && (rawState.status === "scanning" || rawState.status === "done")) {
      if (scanIsForAnotherProfile(rawState, url)) {
        // The tab moved to another profile while the panel was closed, so nothing retired
        // this scan. Clear it like a navigation does; the page reloads and the poll re-reads it.
        await retireScanInPage(tabId, {
          documentId: stateResult?.[0]?.documentId,
          staleHandle: rawState.profileHandle ?? "",
        });
        if (isStale()) return;
        clearRenderedScan();
        profileReady = false;
        latestFollowers = null;
        latestProfileInfo = null;
        updateRunAvailability();
        showLoading();
        return;
      }
      profileReady = true;
      profileWaitStartedAt = null;
      const editing = startedDuringStartup || isScanStarting(tabId);
      const keepControls = editing
        || activityAtStart !== viewActivityOf(tabId, generation) || hasViewWrites(tabId, generation);
      renderState(rawState, !keepControls);
      // An edit made before the scan was restored queued no write; send it now that it's known.
      if (keepControls && !editing && !hasViewWrites(tabId, generation) && !viewMatchesState(currentView(), rawState)) {
        schedulePushView();
      }
      return;
    }
    if (rawState && rawState.status === "error") errorText = rawState.errorText;
  } catch {
    // Not a page Outliers can read (another site, or TikTok before access is on), or mid-load.
    if (isStale()) return;
    profileReady = false;
    latestFollowers = null;
    latestProfileInfo = null;
    clearRenderedScan();
    updateRunAvailability();
    hideReviewPrompt();
    // Chrome can also refuse a profile page itself, when the user limits Outliers' site access.
    // The TikTok card covers TikTok while it's off; otherwise say how to let Outliers in.
    showNotice(
      "Open an Instagram or TikTok profile to scan its videos.",
      hasTikTokAccess
        ? "On a profile already? Chrome may be blocking Outliers on this site: click the puzzle icon in the toolbar and allow Outliers here."
        : undefined
    );
    return;
  }

  // No scan lives in this page (e.g. after a reload), so drop any stale results.
  clearRenderedScan();
  if (errorText) {
    statusEl.textContent = errorText;
    statusEl.className = "status-msg error";
  }

  const ref = url ? getProfileRef(url) : null;
  if (!url || !ref) {
    profileReady = false;
    profileWaitStartedAt = null;
    latestFollowers = null;
    latestProfileInfo = null;
    updateRunAvailability();
    hideReviewPrompt();
    showNotice(
      url && isContentPermalink(url)
        ? "Open the creator's profile to scan their videos."
        : "Open an Instagram or TikTok profile to scan its videos."
    );
    return;
  }

  let info: ProfileInfo | null = null;
  try {
    // The MAIN world sees the page's own data, so the count is exact in any language.
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readProfileInfo,
    });
    info = (result?.[0]?.result as ProfileInfo | null | undefined) ?? null;
  } catch {
    info = null;
  }
  if (isStale()) return;

  if (info && info.headerMatches && info.handle === ref.handle) {
    if (awaitingResetReload) {
      awaitingResetReload = false;
      statusEl.textContent = "";
      statusEl.className = "status-msg";
    }
    latestProfileInfo = info;
    latestFollowers = info.followers;
    if (profileWaitStartedAt == null) profileWaitStartedAt = Date.now();
    const waitedLong = Date.now() - profileWaitStartedAt >= PROFILE_WAIT_HINT_MS;
    // Keep polling until the follower count and the scan tab are both in: either can arrive late.
    profileReady = info.followers !== null && info.onScanTab;
    if (profileReady) profileWaitStartedAt = null;
    updateRunAvailability();
    showStats(getThresholdLabel(selectedFilterMode, latestFollowers, selectedMinViews), readinessHint(info, waitedLong));
    updateReviewPromptVisibility(currentRenderedState);
    return;
  }

  // The profile header has not rendered yet. Keep the spinner up while the poll retries.
  profileReady = false;
  latestFollowers = null;
  latestProfileInfo = null;
  updateRunAvailability();
  hideReviewPrompt();
  if (profileWaitStartedAt == null) profileWaitStartedAt = Date.now();
  if (Date.now() - profileWaitStartedAt < PROFILE_WAIT_HINT_MS) {
    showLoading();
  } else {
    showNotice("Couldn't read this profile yet. Scroll to the top of the profile; Outliers keeps checking.");
  }
}

function adoptProfileFromUrl(url: string | null): void {
  const ref = url ? getProfileRef(url) : null;
  const platform = url ? detectPlatform(url) : null;
  if (ref) lastKnownProfileRef = ref;
  if (platform && platform !== currentPlatform) {
    currentPlatform = platform;
    syncSortUI();
    syncScanLimitUI(getScanLimitFromUI());
  }
}

// What stands between the profile and a scan, with a one-click fix when there is one.
function readinessHint(info: ProfileInfo, waitedLong: boolean): StatsHint | undefined {
  if (!info.onScanTab) {
    if (info.platform === "tiktok") {
      return { text: "Open the Videos tab of this profile to scan it." };
    }
    return {
      text: "Outliers scans the Reels tab.",
      actionLabel: "Open Reels tab",
      onAction: openReelsTab,
    };
  }
  if (info.followers === null && selectedFilterMode === "ratio5x") {
    return waitedLong
      ? { text: "Couldn't read the follower count, so 5× is off. Min Views and All work without it." }
      : { text: "Reading the follower count… Min Views and All work without it." };
  }
  return undefined;
}

function openReelsTab(): void {
  const tabId = cachedTabId;
  const ref = lastKnownProfileRef;
  if (tabId == null || !ref || ref.platform !== "instagram") return;
  chrome.scripting.executeScript({
    target: { tabId },
    args: [ref.handle],
    func: (function (handle: string): void {
      const path = "/" + handle + "/reels/";
      const tab = document.querySelector('a[href="' + path + '"]') as HTMLAnchorElement | null;
      // Clicking Instagram's own tab keeps it a quick in-app navigation.
      if (tab) tab.click();
      else window.location.assign(path);
    }) as unknown as () => void,
  }).catch(function () {
    // Non-fatal; the hint stays up.
  });
}

// Run needs the profile header and its scan tab. Only 5× needs the follower count.
function updateRunAvailability(): void {
  const info = latestProfileInfo;
  const scanning = currentRenderedState?.status === "scanning";
  const starting = cachedTabId != null && isScanStarting(cachedTabId);
  const ready = !!info && info.headerMatches && info.onScanTab
    && (selectedFilterMode !== "ratio5x" || (latestFollowers !== null && latestFollowers > 0));
  runBtn.disabled = scanning || starting || !ready;
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
    updateRunAvailability();
  } else if (msg.type === "outliers:reset") {
    if (reviewPromptShownThisSession) reviewPromptClosedThisSession = true;
    hideProgress();
    hideResults();
    hideReviewPrompt();
    setButtonsForIdle();
    statusEl.textContent = "Outliers cleared.";
    statusEl.className = "status-msg";
    currentRenderedState = null;
    latestProfileInfo = null;
    // The page reloads after a reset; the poll rehydrates once the new document is up.
    runBtn.disabled = true;
    profileReady = false;
  }
});

// ── Navigation detection ──────────────────────────────────────────────────
async function handleNavigation(details: { tabId: number; url: string }, generation: number): Promise<void> {
  if (!isStillBound(details.tabId, generation)) return;

  const newRef = getProfileRef(details.url);
  const newProfile = profileKey(newRef);
  lastKnownUrl = details.url;

  // Opening a video keeps the scan; its viewer closes back onto the same profile.
  if (newProfile === null && isContentPermalink(details.url)) return;
  if (newProfile === lastKnownProfile) {
    // Same profile, another tab of it (profile → Reels). Re-check whether a scan can run there.
    if (currentRenderedState == null) profileReady = false;
    return;
  }

  lastKnownProfile = newProfile;
  lastKnownProfileRef = newRef;
  cancelViewPush();

  await retireScanInPage(details.tabId);
  if (!isStillBound(details.tabId, generation)) return;

  hideProgress();
  hideResults();
  currentRenderedState = null;
  latestFollowers = null;
  latestProfileInfo = null;
  setButtonsForIdle();
  profileReady = false;
  profileWaitStartedAt = null;
  statusEl.textContent = "";
  statusEl.className = "status-msg";
  showLoading();
  // The navigation poll rehydrates on its next tick, once the new profile has rendered.
}

// Drops the page's scan (its reset reloads the page) so it can't be restored onto another profile.
// A scan whose profile the page shows again (or a video viewer over it) is kept: the tab may be
// back on that profile by the time this runs. With `onlyIf`, the reset goes to the document
// that was read and runs only while that page still holds the stale profile's scan.
async function retireScanInPage(
  tabId: number,
  onlyIf?: { documentId: string | undefined; staleHandle: string }
): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: onlyIf?.documentId ? { tabId, documentIds: [onlyIf.documentId] } : { tabId },
      args: [onlyIf ? onlyIf.staleHandle : null],
      func: (function (staleHandle: string | null) {
        const w = window as unknown as {
          __outliers_reset?: () => void;
          __outliers_state?: { profileHandle?: string | null };
          __outliers_active?: boolean;
        };
        const scanned = String(w.__outliers_state?.profileHandle ?? "").toLowerCase();
        if (staleHandle !== null && scanned !== staleHandle.toLowerCase()) return;
        if (scanned) {
          let first = window.location.pathname.split("/")[1] ?? "";
          try {
            first = decodeURIComponent(first);
          } catch {
            // Keep the raw segment
          }
          first = first.toLowerCase();
          if (/^(reel|reels|p|tv)$/.test(first) || first.replace(/^@/, "") === scanned) return;
        }
        if (typeof w.__outliers_reset === "function") w.__outliers_reset();
        w.__outliers_state = undefined;
        w.__outliers_active = false;
      }) as unknown as () => void,
    });
  } catch {
    // Non-fatal: the document is gone, so there is nothing left to retire.
  }
}

// True when the URL shows a profile other than the one the scan belongs to. A video viewer
// (no profile in the URL) keeps its profile's scan.
function scanIsForAnotherProfile(state: OutliersState, url: string | null): boolean {
  const shown = url ? getProfileRef(url) : null;
  if (!shown || !state.profileHandle) return false;
  if (state.platform && state.platform !== shown.platform) return true;
  return state.profileHandle.toLowerCase() !== shown.handle;
}

function syncControlsToView(view: ViewSettings): void {
  syncFilterModeUI(view.filterMode);
  if (view.filterMode === "minViews") syncMinViewsUI(view.minViews);
  selectedSortKey = view.sortKey;
  selectedSortDir = view.sortDir;
  syncSortUI();
}

function viewMatchesState(view: ViewSettings, state: OutliersState): boolean {
  return view.filterMode === state.filterMode
    && view.sortKey === (state.sortKey ?? "views")
    && view.sortDir === (state.sortDir ?? "desc")
    && (view.filterMode !== "minViews" || view.minViews === state.minViews);
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
  const generation = bindGeneration;
  navPollTimer = window.setInterval(function () {
    if (navPollInFlight) return;
    navPollInFlight = true;

    readTabUrl(tabId)
      .then(async function (url) {
        if (!isStillBound(tabId, generation)) return;
        if (url) {
          if (lastKnownUrl == null) {
            lastKnownUrl = url;
            lastKnownProfileRef = getProfileRef(url);
            lastKnownProfile = profileKey(lastKnownProfileRef);
          } else if (url !== lastKnownUrl) {
            await handleNavigation({ tabId, url }, generation);
          }
        }
        if (!profileReady && isStillBound(tabId, generation)) await rehydrate(tabId);
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
    statusEl.textContent = "Nothing to export for the current Show setting.";
    statusEl.className = "status-msg error";
    return;
  }

  const csv = buildOutliersCsv(currentRenderedState.outliers, {
    profilePath: currentProfileUrl() ?? normalizeProfileUrl(null, currentRenderedState.outliers[0]?.url),
    filterMode: currentRenderedState.filterMode,
    thresholdLabel: currentRenderedState.activeThresholdLabel,
    exportedAt: nowIso(),
    followers: currentRenderedState.followers,
    sortKey: currentRenderedState.sortKey,
    sortDir: currentRenderedState.sortDir,
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = [
    "outliers",
    sanitizeFilenamePart(lastKnownProfileRef ? lastKnownProfileRef.platform + "_" + lastKnownProfileRef.handle : "profile"),
    getLocalTimestampForFilename(),
  ].join("_") + ".csv";

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  statusEl.textContent = "CSV exported.";
  statusEl.className = "status-msg";
  offerReviewPrompt("CSV export");
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
  offerReviewPrompt("Library export");
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
  copyTextWithStatus(buildOutliersPlainText(state), "List copied.");
  offerReviewPrompt("copy");
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
  const generation = bindGeneration;
  const startup: ScanStartup = { tabId: cachedTabId ?? -1, view: currentView() };
  if (cachedTabId != null) startingScans.set(cachedTabId, startup);
  // The panel may follow other tabs and come back while this runs; it speaks for the startup
  // whenever it shows this tab again.
  const showsTab = function (): boolean {
    return cachedTabId === startup.tabId;
  };
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
      showError("No active tab found.");
      setButtonsForIdle();
      return;
    }
    if (startup.tabId !== tabId) {
      startup.tabId = tabId;
      startingScans.set(tabId, startup);
    }

    const limit = getScanLimitFromUI();
    const view = startup.view;
    // The scan belongs to this document and profile; a reload or navigation mid-startup
    // abandons it. Switching to another tab doesn't: the startup finishes on its own tab
    // and the panel shows it on return. Only a panel still on that tab updates the UI.
    const epoch = documentEpoch;
    const expected = lastKnownProfileRef;
    const bound = function (): boolean {
      return isStillBound(tabId, generation);
    };
    const pageChanged = function (): boolean {
      return bound() && epoch !== documentEpoch;
    };

    saveFilterMode(view.filterMode);
    if (view.filterMode === "minViews") saveMinViews(view.minViews);
    saveSort(selectedSortKey, selectedSortDir);

    statusEl.textContent = "Starting scan…";

    // Read the profile again right before seeding the scanner, so the follower count it gets
    // belongs to the page it will scroll, not to one the tab showed a moment ago.
    const fresh = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readProfileInfo,
    });
    if (pageChanged()) return;
    // Later injections go to the document read here; if the tab loads another one meanwhile,
    // Chrome rejects them. The scanner itself stops if the page moved to another profile.
    const documentId = fresh?.[0]?.documentId;
    const target = documentId ? { tabId, documentIds: [documentId] } : { tabId };
    const info = (fresh?.[0]?.result as ProfileInfo | null | undefined) ?? null;
    if (!info || !info.headerMatches || !info.onScanTab || !expected
      || info.platform !== expected.platform || info.handle !== expected.handle) {
      if (showsTab()) {
        profileReady = false;
        statusEl.textContent = "The page changed. Wait for the profile to load, then run the scan again.";
        statusEl.className = "status-msg error";
        setButtonsForIdle();
      }
      return;
    }
    // 5× compares views with followers; without a count every video would be filtered out.
    if (startup.view.filterMode === "ratio5x" && !(typeof info.followers === "number" && info.followers > 0)) {
      if (showsTab()) {
        profileReady = false;
        statusEl.textContent = "Couldn't read the follower count yet. Wait for the profile to load, or choose Min Views or All.";
        statusEl.className = "status-msg error";
        setButtonsForIdle();
      }
      return;
    }

    // The bridge runs in the page's own world to read exact counts; it only answers the scanner.
    await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      files: ["page-bridge.js"],
    });
    if (pageChanged()) return;

    await chrome.scripting.executeScript({
      target,
      func: (function (l: number | null, v: ViewSettings, p: { handle: string; followers: number | null }) {
        const w = window as unknown as {
          __outliers_scan_limit: number | null | undefined;
          __outliers_view: ViewSettings | undefined;
          __outliers_profile: { handle: string; followers: number | null } | undefined;
        };
        w.__outliers_scan_limit = l;
        w.__outliers_view = v;
        w.__outliers_profile = p;
      }) as unknown as () => void,
      // The latest Show/Sort made on this tab: it may have changed since the click. Later edits
      // reach the page through schedulePushView, before or after the scanner starts.
      args: [limit, startup.view, { handle: info.handle, followers: info.followers }],
    });
    if (pageChanged()) return;

    await chrome.scripting.executeScript({
      target,
      files: ["injected.js"],
    });
    if (pageChanged() || !showsTab()) return;

    // The scanner may already have stopped with an error (the page left the scan tab, say), and
    // its message can beat this point; show what it actually reports rather than "scanning".
    const started = await chrome.scripting.executeScript({
      target,
      func: function (): OutliersState | null {
        return (window as unknown as { __outliers_state?: OutliersState }).__outliers_state ?? null;
      },
    });
    if (pageChanged() || !showsTab()) return;
    const startedState = (started?.[0]?.result as OutliersState | null | undefined) ?? null;
    if (startedState && (startedState.status === "error" || startedState.status === "done")) {
      renderState(startedState);
      return;
    }

    setButtonsForScanning();
    statusEl.textContent = "";
  } catch (err: unknown) {
    if (!showsTab()) return;
    const message = err instanceof Error ? err.message : "Something went wrong.";
    statusEl.textContent = message;
    statusEl.className = "status-msg error";
    setButtonsForIdle();
  } finally {
    // A newer Run on this tab owns its entry now if one started meanwhile.
    if (startingScans.get(startup.tabId) === startup) startingScans.delete(startup.tabId);
    // Run was held off while this started; let it reflect the tab again.
    if (showsTab()) updateRunAvailability();
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
  const generation = bindGeneration;
  const tabId = cachedTabId;

  try {
    if (tabId != null) {
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

  if (tabId == null || !isStillBound(tabId, generation)) return;

  hideProgress();
  hideResults();
  setButtonsForIdle();
  runBtn.disabled = true;
  currentRenderedState = null;
  latestFollowers = null;
  statusEl.textContent = "Waiting for page reload…";
  awaitingResetReload = true;
  showLoading();
  // The reload fires tabs.onUpdated, and the poll rehydrates once the page is back.
  profileReady = false;
});

scanLimitSlider.addEventListener("input", function () {
  const limit = sliderPositionToScanLimit(getRangeValue(scanLimitSlider));
  syncScanLimitUI(limit);
  saveScanLimit(limit);
});

for (let i = 0; i < filterModeBtns.length; i++) {
  filterModeBtns[i]!.addEventListener("click", function () {
    const raw = this.getAttribute("data-mode");
    const mode: FilterMode = isFilterMode(raw) ? raw : "ratio5x";
    syncFilterModeUI(mode);
    if (mode === "minViews" && (!selectedMinViews || selectedMinViews <= 0)) {
      syncMinViewsUI(DEFAULT_MIN_VIEWS);
      saveMinViews(DEFAULT_MIN_VIEWS);
    }
    saveFilterMode(mode);
    setFilterControlsDisabled(false);
    onViewChanged();
  });
}

// Before a scan, keep the stats in step with the controls. During and after one, the page
// refilters what it collected and answers with a new state.
function onViewChanged(): void {
  if (cachedTabId != null) bumpViewActivity(cachedTabId, bindGeneration);
  const status = currentRenderedState?.status;
  if (status === "done" || status === "scanning") {
    schedulePushView();
    return;
  }
  // While Run is starting a scan the page takes the change too: the scanner reads it as it begins.
  const startup = cachedTabId != null ? startingScans.get(cachedTabId) : undefined;
  if (startup) {
    startup.view = currentView();
    schedulePushView();
  }
  updateRunAvailability();
  if (latestProfileInfo) {
    const waitedLong = profileWaitStartedAt != null && Date.now() - profileWaitStartedAt >= PROFILE_WAIT_HINT_MS;
    showStats(getThresholdLabel(selectedFilterMode, latestFollowers, selectedMinViews), readinessHint(latestProfileInfo, waitedLong));
  }
}

function cancelViewPush(): void {
  pendingViewPush = null;
  if (viewPushTimer == null) return;
  clearTimeout(viewPushTimer);
  viewPushTimer = null;
}

// Switching tabs must not drop a Show/Sort change still waiting to reach the page: send it to
// the tab it was made on right away. Call before the bind moves to another tab.
function flushViewPush(): void {
  const pending = pendingViewPush;
  cancelViewPush();
  if (!pending) return;
  pushViewToPage(pending).catch(function () {
    // Non-fatal
  });
}

function isScanStarting(tabId: number): boolean {
  return startingScans.has(tabId);
}

function viewWriteKey(tabId: number, generation: number): string {
  return tabId + ":" + generation;
}

function viewActivityOf(tabId: number, generation: number): number {
  return viewActivity.get(viewWriteKey(tabId, generation)) ?? 0;
}

function bumpViewActivity(tabId: number, generation: number): void {
  const key = viewWriteKey(tabId, generation);
  viewActivity.set(key, (viewActivity.get(key) ?? 0) + 1);
}

function hasViewWrites(tabId: number, generation: number): boolean {
  if (pendingViewPush && pendingViewPush.tabId === tabId && pendingViewPush.generation === generation) return true;
  return (viewWritesInFlight.get(viewWriteKey(tabId, generation)) ?? 0) > 0;
}

function schedulePushView(): void {
  cancelViewPush();
  const tabId = cachedTabId;
  if (tabId == null) return;
  const push: PendingViewPush = {
    tabId,
    generation: bindGeneration,
    epoch: documentEpoch,
    view: currentView(),
    handle: lastKnownProfileRef?.handle ?? currentRenderedState?.profileHandle ?? null,
  };
  pendingViewPush = push;
  // Coalesce slider drags into one redraw of the page grid.
  viewPushTimer = window.setTimeout(function () {
    viewPushTimer = null;
    pendingViewPush = null;
    pushViewToPage(push).catch(function () {
      // Non-fatal
    });
  }, 90);
}

async function pushViewToPage(push: PendingViewPush): Promise<void> {
  const { tabId, generation } = push;
  if (!isStillBound(tabId, generation) || push.epoch !== documentEpoch) return;
  const key = viewWriteKey(tabId, generation);
  viewWritesInFlight.set(key, (viewWritesInFlight.get(key) ?? 0) + 1);
  bumpViewActivity(tabId, generation);
  let accepted = true;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [push.view, push.handle],
      func: (function (v: ViewSettings, handle: string | null): boolean {
        const w = window as unknown as {
          __outliers_active?: boolean;
          __outliers_apply_view?: (view: ViewSettings) => void;
          __outliers_view?: ViewSettings;
          __outliers_state?: { profileHandle?: string | null };
        };
        // The tab may have moved on since the change was made (a flushed write runs after the
        // panel has left it): apply it only to the profile it was made on.
        if (handle) {
          const want = handle.toLowerCase();
          let first = window.location.pathname.split("/")[1] ?? "";
          try {
            first = decodeURIComponent(first);
          } catch {
            // Keep the raw segment
          }
          first = first.toLowerCase();
          // A video viewer (Instagram /reel/…, /p/…) keeps the profile's scan underneath.
          const shown = /^(reel|reels|p|tv)$/.test(first) ? null : first.replace(/^@/, "");
          if (shown !== null && shown !== want) return false;
          const scanned = w.__outliers_state?.profileHandle;
          if (scanned && scanned.toLowerCase() !== want) return false;
        }
        // A scanner that is still starting reads this as it begins; a running or finished one
        // redraws now. One that failed or was reset is retired and must not take it.
        w.__outliers_view = v;
        if (w.__outliers_active === true && typeof w.__outliers_apply_view === "function") w.__outliers_apply_view(v);
        return true;
      }) as unknown as () => void,
    });
    accepted = (results?.[0]?.result as boolean | undefined) !== false;
  } catch {
    if (!isStillBound(tabId, generation)) return;
    statusEl.textContent = "Couldn't update the page. Reset and scan again.";
    statusEl.className = "status-msg error";
  } finally {
    const left = (viewWritesInFlight.get(key) ?? 1) - 1;
    if (left > 0) viewWritesInFlight.set(key, left);
    else viewWritesInFlight.delete(key);
    bumpViewActivity(tabId, generation);
  }
  // The page is no longer on that profile, so the controls may be ahead of it: re-read it.
  if (!accepted && isStillBound(tabId, generation)) {
    profileReady = false;
  }
}

minViewsSlider.addEventListener("input", function () {
  const minViews = sliderPositionToMinViews(getRangeValue(minViewsSlider));
  syncMinViewsUI(minViews);
  saveMinViews(minViews);
  onViewChanged();
});

sortKeySelect.addEventListener("change", function () {
  const key = sortKeySelect.value;
  if (!isSortKey(key)) return;
  selectedSortKey = key;
  saveSort(selectedSortKey, selectedSortDir);
  syncSortUI();
  onViewChanged();
});

sortDirBtn.addEventListener("click", function () {
  selectedSortDir = selectedSortDir === "desc" ? "asc" : "desc";
  saveSort(selectedSortKey, selectedSortDir);
  syncSortUI();
  onViewChanged();
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
  const sort = loadSort();
  selectedSortKey = sort.key;
  selectedSortDir = sort.dir;
  syncSortUI();
  setFilterControlsDisabled(false);
  await refreshTikTokAccess();
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

  // A success from an earlier session earns the ask on this open, once the panel has settled.
  if (reviewPromptState.firstSuccessfulScanAt) {
    reviewPromptDelayTimer = window.setTimeout(function () {
      reviewPromptDelayTimer = null;
      offerReviewPrompt("panel open");
    }, REVIEW_PROMPT_OPEN_DELAY_MS);
  }

  const onAccessChanged = function (): void {
    const wasOn = hasTikTokAccess;
    refreshTikTokAccess().then(function () {
      if (wasOn === hasTikTokAccess || cachedTabId == null) return;
      statsMessageKey = null;
      bindToTab(cachedTabId).catch(function () {
        // Non-fatal
      });
    }).catch(function () {
      // Non-fatal
    });
  };
  chrome.permissions.onAdded.addListener(onAccessChanged);
  chrome.permissions.onRemoved.addListener(onAccessChanged);

  try {
    panelWindowId = (await chrome.windows.getCurrent()).id ?? null;
  } catch {
    panelWindowId = null;
  }
  chrome.tabs.onActivated.addListener(function (info) {
    if (panelWindowId != null && info.windowId !== panelWindowId) return;
    if (info.tabId === cachedTabId) return;
    bindToTab(info.tabId).catch(function () {
      // Non-fatal
    });
  });
  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
    if (tabId !== cachedTabId) return;
    if (changeInfo.status !== "loading" && changeInfo.status !== "complete") return;
    documentEpoch++;
    // A reload or new document wipes the page's scan state, and a non-Instagram URL is
    // not reported to us at all, so re-read whatever the tab shows next. In-page URL
    // changes (a reel modal) keep the page's scan state, and rehydrate restores it.
    profileReady = false;
  });
  window.addEventListener("beforeunload", stopNavigationPolling);

  const tabId = await getActiveTabId();
  if (!tabId) {
    showNotice("Open an Instagram or TikTok profile to scan its videos.");
    return;
  }
  await bindToTab(tabId);
}

// The side panel belongs to the window, so it follows whichever tab is active.
async function bindToTab(tabId: number): Promise<void> {
  flushViewPush();
  const generation = ++bindGeneration;
  cachedTabId = tabId;
  stopNavigationPolling();
  lastKnownUrl = null;
  lastKnownProfile = null;
  lastKnownProfileRef = null;
  profileReady = false;
  profileWaitStartedAt = null;
  latestFollowers = null;
  latestProfileInfo = null;
  currentRenderedState = null;
  hideProgress();
  hideResults();
  hideReviewPrompt();
  setButtonsForIdle();
  statusEl.textContent = "";
  statusEl.className = "status-msg";
  showLoading();
  // Back on a tab whose scan is still starting: show the Show/Sort it starts with and keep Run
  // off until it's running (its first state message takes over).
  const startup = startingScans.get(tabId);
  if (startup) {
    syncControlsToView(startup.view);
    setButtonsDisabled();
  }

  const url = await readTabUrl(tabId);
  if (generation !== bindGeneration) return;
  lastKnownUrl = url;
  lastKnownProfileRef = url ? getProfileRef(url) : null;
  lastKnownProfile = profileKey(lastKnownProfileRef);

  startNavigationPolling(tabId);
  await rehydrate(tabId);
}

function isStillBound(tabId: number, generation: number): boolean {
  return tabId === cachedTabId && generation === bindGeneration;
}

init();
