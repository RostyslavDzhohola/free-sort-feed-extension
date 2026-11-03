// Island for the scan replay (components/demo/Demo.astro). All scan logic lives in lib/demo-engine.ts;
// this file wires it to the DOM and drives the side panel only through the hooks in components/panel/types.ts.
import {
  MIN_VIEWS_SLIDER_MAX,
  SCAN_SLIDER_MAX,
  buildOutliersCsv,
  formatExact,
  formatMetricPhrase,
  formatScanLimit,
  metricValue,
  minViewsToSliderPosition,
  scanLimitToSliderPosition,
  sliderPositionToMinViews,
  sliderPositionToScanLimit,
  type FilterMode,
  type SortKey,
} from "@outliers/core";
import type { SnapshotReel } from "../../data/demo/types";
import {
  BATCH_SIZE,
  activeThreshold,
  collectBatch,
  emptyState,
  finishScan,
  gridMeta,
  hasPendingChanges,
  initialState,
  plainTextReport,
  progressText,
  resetScan,
  resultsMeta,
  resultsTitle,
  sortDirLabel,
  startScan,
  stopScan,
  updateSettings,
  type ScanState,
} from "../../lib/demo-engine";
import { avatarHtml, escapeHtml, limitNote, resultRowHtml, tileHtml } from "../../lib/demo-render";
import { creditFor, honestyLabel, type CopyProfile } from "../../lib/demo-copy";
import { trackGoal } from "../../lib/analytics";
import { prefersReducedMotion } from "../../lib/motion";
import { stepByValue } from "../../lib/range-keys";
import { PANEL_HOOKS } from "../panel/types";

/** One profile in Demo.astro's inline payload: the label fields (CopyProfile) plus what the replay needs. */
interface DemoProfileData extends CopyProfile {
  followers: number;
  followersText: string;
  assetBase: string;
  /** Profile photo URL, or null for initials. */
  avatar: string | null;
  reels: SnapshotReel[];
}

const root = document.querySelector<HTMLElement>("[data-demo]");
if (root) mount(root);

function mount(root: HTMLElement): void {
  const { profiles } = JSON.parse(root.querySelector("[data-demo-data]")!.textContent!) as { profiles: DemoProfileData[] };
  if (profiles.length === 0) return;

  const el = <T extends HTMLElement = HTMLElement>(attr: string) => root.querySelector<T>(`[${attr}]`)!;
  const panel = {
    handle: el(PANEL_HOOKS.handle),
    followers: el(PANEL_HOOKS.followers),
    thresholdTitle: el(PANEL_HOOKS.thresholdTitle),
    threshold: el(PANEL_HOOKS.threshold),
    limit: el<HTMLInputElement>(PANEL_HOOKS.limit),
    limitValue: el(PANEL_HOOKS.limitValue),
    limitNote: el(PANEL_HOOKS.limitNote),
    modes: Array.from(root.querySelectorAll<HTMLButtonElement>(`[${PANEL_HOOKS.mode}]`)),
    minViewsArea: el(PANEL_HOOKS.minViewsArea),
    minViews: el<HTMLInputElement>(PANEL_HOOKS.minViews),
    minViewsValue: el(PANEL_HOOKS.minViewsValue),
    sortKey: el<HTMLSelectElement>(PANEL_HOOKS.sortKey),
    sortDir: el<HTMLButtonElement>(PANEL_HOOKS.sortDir),
    run: el<HTMLButtonElement>(PANEL_HOOKS.run),
    stop: el<HTMLButtonElement>(PANEL_HOOKS.stop),
    reset: el<HTMLButtonElement>(PANEL_HOOKS.reset),
    status: el(PANEL_HOOKS.status),
    progress: el(PANEL_HOOKS.progress),
    progressFill: el(PANEL_HOOKS.progressFill),
    progressText: el(PANEL_HOOKS.progressText),
    results: el(PANEL_HOOKS.results),
    resultsTitle: el(PANEL_HOOKS.resultsTitle),
    meta: el(PANEL_HOOKS.meta),
    list: el(PANEL_HOOKS.list),
    empty: el(PANEL_HOOKS.empty),
    emptyTitle: el(PANEL_HOOKS.emptyTitle),
    emptyDetail: el(PANEL_HOOKS.emptyDetail),
    csv: el<HTMLButtonElement>(PANEL_HOOKS.csv),
    copy: el<HTMLButtonElement>(PANEL_HOOKS.copy),
  };
  const page = {
    profiles: Array.from(root.querySelectorAll<HTMLButtonElement>("[data-demo-profile]")),
    url: el("data-demo-url"),
    profileLink: el<HTMLAnchorElement>("data-demo-profile-link"),
    avatar: el("data-demo-avatar"),
    handle: el("data-demo-handle"),
    followers: el("data-demo-followers"),
    viewport: el("data-demo-viewport"),
    grid: el("data-demo-grid"),
    gridHead: el("data-demo-grid-head"),
    gridHandle: el("data-demo-grid-handle"),
    gridMeta: el("data-demo-grid-meta"),
    gridEmpty: el("data-demo-grid-empty"),
    gridEmptyTitle: el("data-demo-grid-empty-title"),
    gridEmptyDetail: el("data-demo-grid-empty-detail"),
    lock: el("data-demo-lock"),
    hint: el("data-demo-hint"),
    honesty: el("data-demo-honesty"),
    credit: el("data-demo-credit"),
    creditLead: el("data-demo-credit-lead"),
    creditLink: el<HTMLAnchorElement>("data-demo-credit-link"),
    creditHandle: el("data-demo-credit-handle"),
    creditDetail: el("data-demo-credit-detail"),
    notice: el("data-demo-notice"),
    followWrap: el("data-demo-follow-wrap"),
    follow: el<HTMLAnchorElement>("data-demo-follow"),
    followHandle: el("data-demo-follow-handle"),
    live: el("data-demo-live"),
  };
  const zones = Array.from(root.querySelectorAll<HTMLElement>("[data-zone]"));
  const reduced = prefersReducedMotion();

  let profile = profiles[0]!;
  let gridIndex = indexByUrl(profile);
  let state: ScanState<SnapshotReel> = initialState();
  let timer = 0;
  let gridShowsResults = false;

  // ── Rendering ───────────────────────────────────────────────────────
  function render(): void {
    renderControls();
    renderProgressAndResults();
    renderGrid();
    renderNotes();
  }

  function renderControls(): void {
    const { settings, phase } = state;
    const scanning = phase === "scanning";
    const bar = activeThreshold(settings, profile.followers);
    panel.thresholdTitle.textContent = bar.title;
    panel.threshold.textContent = bar.label;

    const note = limitNote(profile.kind, profile.reels.length);
    syncRange(panel.limit, scanLimitToSliderPosition(settings.scanLimit), SCAN_SLIDER_MAX, `${formatScanLimit(settings.scanLimit)}. ${note}`);
    panel.limitValue.textContent = formatScanLimit(settings.scanLimit);
    panel.limitNote.textContent = note;
    // Only the scan limit locks while scanning; Show and Sort by reshape what's been collected.
    panel.limit.disabled = scanning;

    for (const button of panel.modes) {
      const on = button.dataset.panelMode === settings.mode;
      button.classList.toggle("on", on);
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on ? 0 : -1;
    }
    panel.minViewsArea.hidden = settings.mode !== "minViews";
    const minLabel = formatExact(settings.minViews) + " views";
    syncRange(panel.minViews, minViewsToSliderPosition(settings.minViews), MIN_VIEWS_SLIDER_MAX, minLabel);
    panel.minViewsValue.textContent = minLabel;

    panel.sortKey.value = settings.sortKey;
    const dir = sortDirLabel(settings.sortDir);
    panel.sortDir.textContent = dir.text;
    panel.sortDir.setAttribute("aria-label", dir.aria);

    // Run → Stop → Reset swap places; if the focused one disappears, hand focus to its replacement.
    const actions = [panel.run, panel.stop, panel.reset];
    const focused = actions.find((b) => b === document.activeElement);
    panel.run.hidden = phase !== "idle";
    panel.stop.hidden = phase !== "scanning";
    panel.reset.hidden = phase !== "done";
    if (focused?.hidden) actions.find((b) => !b.hidden)?.focus();
  }

  function renderProgressAndResults(): void {
    const { phase, scannedLimit, collected, result, settings } = state;
    panel.progress.hidden = phase !== "scanning";
    if (phase === "scanning") {
      const pct = scannedLimit != null ? Math.min(100, (collected / scannedLimit) * 100) : 100;
      panel.progressFill.style.width = pct.toFixed(1) + "%";
      panel.progressFill.classList.toggle("pulse", scannedLimit == null);
      panel.progressText.textContent = progressText(collected, scannedLimit);
    }

    const outliers = result?.outliers ?? [];
    // Like the extension: while scanning, the list appears with its first result.
    panel.results.hidden = phase === "idle" || !result || (phase === "scanning" && outliers.length === 0);
    if (!result) return;
    panel.resultsTitle.textContent = resultsTitle(settings.mode);
    panel.meta.textContent = resultsMeta(outliers.length, collected);
    panel.list.innerHTML = outliers.map((reel, i) => resultRowHtml(reel, i + 1, result.sortKey, profile.followers, profile.assetBase)).join("");
    const showEmpty = phase === "done" && outliers.length === 0;
    panel.empty.hidden = !showEmpty;
    if (showEmpty) {
      const copy = emptyState(state, profile.followers);
      panel.emptyTitle.textContent = copy.title;
      panel.emptyDetail.textContent = copy.detail;
    }
    const ready = phase === "done" && outliers.length > 0;
    panel.csv.disabled = !ready;
    panel.copy.disabled = !ready;
  }

  /**
   * Before/while scanning: the newest-first grid. Once done: the extension's page grid, a card per
   * listed Reel in the panel's order, headed by the sorted metric. Show and Sort by re-render it.
   */
  function renderGrid(): void {
    const ranked = state.phase === "done";
    if (ranked) {
      const result = state.result;
      const outliers = result?.outliers ?? [];
      const sortKey: SortKey = result?.sortKey ?? "views";
      page.grid.innerHTML = outliers
        .map((reel, i) =>
          tileHtml(reel, gridIndex.get(reel.url) ?? i, profile.assetBase, {
            rank: i + 1,
            ratio: reel.ratio,
            label: formatMetricPhrase(sortKey, metricValue(reel, sortKey, profile.followers)),
          })
        )
        .join("");
      page.gridMeta.textContent = gridMeta(state, profile.followers);
      page.gridEmpty.hidden = outliers.length > 0;
      if (outliers.length === 0) {
        const copy = emptyState(state, profile.followers);
        page.gridEmptyTitle.textContent = copy.title;
        page.gridEmptyDetail.textContent = copy.detail;
      }
      if (!gridShowsResults) page.viewport.scrollTop = 0;
    } else if (gridShowsResults || page.grid.childElementCount !== profile.reels.length) {
      page.grid.innerHTML = profile.reels.map((reel, i) => tileHtml(reel, i, profile.assetBase)).join("");
      page.gridEmpty.hidden = true;
      page.viewport.scrollTop = 0;
    }
    gridShowsResults = ranked;
    page.gridHead.hidden = !ranked;
    page.grid.classList.toggle("ranked", ranked);
    page.lock.hidden = state.phase !== "scanning";
  }

  function renderNotes(): void {
    page.notice.hidden = !hasPendingChanges(state);
    page.followWrap.hidden = !(state.phase === "done" && profile.kind === "real");
  }

  function renderProfile(): void {
    page.url.textContent = profile.handle;
    panel.handle.textContent = "@" + profile.handle;
    panel.followers.textContent = formatExact(profile.followers);
    page.gridHandle.textContent = profile.handle;
    page.profileLink.href = `https://www.instagram.com/${profile.handle}/`;
    page.avatar.innerHTML = avatarHtml(profile.handle, profile.avatar);
    page.handle.textContent = profile.handle;
    page.followers.textContent = profile.followersText + " followers";
    page.honesty.textContent = honestyLabel(profile);
    const credit = creditFor(profile);
    page.credit.hidden = !credit;
    if (credit) {
      page.creditLead.textContent = credit.lead;
      page.creditLink.href = credit.href;
      page.creditHandle.textContent = credit.handle;
      page.creditDetail.textContent = credit.detail;
    }
    page.follow.href = `https://www.instagram.com/${profile.handle}/`;
    page.followHandle.textContent = profile.handle;
    for (const button of page.profiles) {
      const on = button.dataset.demoProfile === profile.handle;
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on ? 0 : -1;
    }
  }

  // ── Scanning ────────────────────────────────────────────────────────
  function tickDelay(): number {
    const target = Math.min(state.scannedLimit ?? profile.reels.length, profile.reels.length);
    const batches = Math.max(1, Math.ceil(target / BATCH_SIZE));
    return Math.min(1200, Math.max(260, Math.round(3600 / batches)));
  }

  function tick(): void {
    state = collectBatch(state, profile.reels, profile.followers);
    render();
    if (state.phase === "done") {
      finish();
      return;
    }
    followScroll();
    timer = window.setTimeout(tick, tickDelay());
  }

  /** Keep the newest collected row in view, the way the extension scrolls the page. */
  function followScroll(): void {
    const tile = page.grid.children[state.collected - 1] as HTMLElement | undefined;
    if (!tile) return;
    const top = Math.max(0, tile.offsetTop + tile.offsetHeight - page.viewport.clientHeight + 12);
    page.viewport.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }

  function finish(): void {
    window.clearTimeout(timer);
    const { result, collected, settings } = state;
    const count = result?.outliers.length ?? 0;
    const bar = activeThreshold(settings, profile.followers).label;
    announce(
      settings.mode === "all"
        ? `Scan complete. ${collected} Reels, sorted.`
        : count > 0
          ? `Scan complete. ${count} of ${collected} Reels cleared ${bar}.`
          : `Scan complete. No Reels cleared ${bar}.`
    );
  }

  function run(): void {
    if (state.phase !== "idle") return;
    state = startScan(state, profile.reels, profile.followers);
    trackGoal("demo_run", { profile: profile.handle, mode: state.settings.mode });
    setStatus("");
    announce(`Scanning @${profile.handle}'s Reels.`);
    if (reduced) {
      state = finishScan(state, profile.reels, profile.followers);
      render();
      finish();
      return;
    }
    render();
    timer = window.setTimeout(tick, 300);
  }

  function stop(): void {
    window.clearTimeout(timer);
    state = stopScan(state);
    render();
    finish();
  }

  function reset(): void {
    window.clearTimeout(timer);
    state = resetScan(state);
    render();
    setStatus("Outliers cleared.");
    announce("Outliers cleared.");
  }

  function selectProfile(handle: string, focus = false): void {
    const next = profiles.find((p) => p.handle === handle);
    if (!next || next === profile) return;
    window.clearTimeout(timer);
    profile = next;
    gridIndex = indexByUrl(profile);
    state = resetScan(state);
    gridShowsResults = true; // force a fresh grid
    renderProfile();
    render();
    setStatus("");
    announce(`Showing @${profile.handle}.`);
    if (focus) page.profiles.find((b) => b.dataset.demoProfile === handle)?.focus();
  }

  // ── Settings ────────────────────────────────────────────────────────
  function update(patch: Parameters<typeof updateSettings>[1]): void {
    state = updateSettings(state, patch, profile.reels, profile.followers);
    render();
  }

  function setMode(mode: FilterMode): void {
    update({ mode });
  }

  panel.limit.addEventListener("input", () => {
    const position = Number(panel.limit.value);
    update({ scanLimit: sliderPositionToScanLimit(position) });
    panel.limit.value = String(position); // let the thumb follow the pointer; it snaps on release
    setFill(panel.limit, position, SCAN_SLIDER_MAX);
  });
  panel.limit.addEventListener("change", () => render());
  panel.minViews.addEventListener("input", () => {
    const position = Number(panel.minViews.value);
    update({ minViews: sliderPositionToMinViews(position) });
    panel.minViews.value = String(position);
    setFill(panel.minViews, position, MIN_VIEWS_SLIDER_MAX);
  });
  panel.minViews.addEventListener("change", () => render());
  stepByValue(panel.limit, sliderPositionToScanLimit, () => state.settings.scanLimit);
  stepByValue(panel.minViews, sliderPositionToMinViews, () => state.settings.minViews);
  panel.sortKey.addEventListener("change", () => update({ sortKey: panel.sortKey.value as SortKey }));
  panel.sortDir.addEventListener("click", () => update({ sortDir: state.settings.sortDir === "desc" ? "asc" : "desc" }));

  wireRadioGroup(panel.modes, (button) => setMode(button.dataset.panelMode as FilterMode));
  wireRadioGroup(page.profiles, (button, viaKeyboard) => selectProfile(button.dataset.demoProfile!, viaKeyboard));

  panel.run.addEventListener("click", run);
  panel.stop.addEventListener("click", stop);
  panel.reset.addEventListener("click", reset);

  // ── Export & copy ───────────────────────────────────────────────────
  panel.csv.addEventListener("click", () => {
    const result = state.result;
    if (state.phase !== "done" || !result) {
      setStatus("Run a scan first to export CSV.");
      return;
    }
    if (result.outliers.length === 0) {
      setStatus("Nothing to export for the current Show setting.");
      return;
    }
    const csv = buildOutliersCsv(result.outliers, {
      profilePath: `https://www.instagram.com/${profile.handle}/`,
      filterMode: state.settings.mode,
      thresholdLabel: activeThreshold(state.settings, profile.followers).label,
      exportedAt: new Date().toISOString(),
      followers: profile.followers,
      sortKey: result.sortKey,
      sortDir: result.sortDir,
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `outliers_instagram_${profile.handle}_replay.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("CSV exported.");
  });

  panel.copy.addEventListener("click", () => {
    if (!state.result || state.result.outliers.length === 0) {
      setStatus("No outliers available to copy yet.");
      return;
    }
    copyText(plainTextReport(state, profile.handle, profile.followers)).then((ok) =>
      setStatus(ok ? "List copied." : "Copy failed. Please try again.")
    );
  });

  panel.list.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy-url]");
    if (!button) return;
    copyText(button.dataset.copyUrl!).then((ok) => {
      const icon = button.innerHTML;
      button.textContent = ok ? "✓" : "!";
      window.setTimeout(() => (button.innerHTML = icon), 1500);
    });
  });

  // ── Hints (the five annotations) ────────────────────────────────────
  function showHint(zone: string): void {
    zones.forEach((z) => z.classList.toggle("active", z.dataset.zone === zone));
    const source = root!.querySelector<HTMLElement>(`#demo-hint-${zone}`);
    if (source) page.hint.innerHTML = `<b>${zone} · ${escapeHtml(source.dataset.hintTitle ?? "")}.</b> ${source.innerHTML}`;
  }
  for (const zone of zones) {
    zone.addEventListener("pointerenter", () => showHint(zone.dataset.zone!));
    zone.addEventListener("focusin", () => showHint(zone.dataset.zone!));
  }
  root.querySelectorAll<HTMLButtonElement>("[data-hint]").forEach((pin) => pin.addEventListener("click", () => showHint(pin.dataset.hint!)));

  // ── Helpers ─────────────────────────────────────────────────────────
  function setStatus(text: string): void {
    panel.status.textContent = text;
  }

  function announce(text: string): void {
    page.live.textContent = text;
  }

  renderProfile();
  render();
}

function indexByUrl(profile: DemoProfileData): Map<string, number> {
  return new Map(profile.reels.map((reel, i) => [reel.url, i]));
}

function setFill(input: HTMLInputElement, position: number, max: number): void {
  input.style.setProperty("--fill", ((position / max) * 100).toFixed(2) + "%");
}

function syncRange(input: HTMLInputElement, position: number, max: number, valueText: string): void {
  input.value = String(position);
  input.setAttribute("aria-valuetext", valueText);
  setFill(input, position, max);
}

/** Roving-tabindex radio group: click or Arrow/Home/End selects. */
function wireRadioGroup(buttons: HTMLButtonElement[], onSelect: (button: HTMLButtonElement, viaKeyboard: boolean) => void): void {
  buttons.forEach((button, i) => {
    button.addEventListener("click", () => onSelect(button, false));
    button.addEventListener("keydown", (event) => {
      const last = buttons.length - 1;
      const target =
        event.key === "ArrowRight" || event.key === "ArrowDown" ? (i === last ? 0 : i + 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (i === 0 ? last : i - 1)
        : event.key === "Home" ? 0
        : event.key === "End" ? last
        : -1;
      if (target < 0) return;
      event.preventDefault();
      const next = buttons[target]!;
      if (next.disabled) return;
      next.focus();
      onSelect(next, true);
    });
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
