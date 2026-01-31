# Agents.md — Internal Architecture

This document describes the Chrome extension's internal components as cooperating "agents", each with a distinct role, lifecycle, and communication pattern.

## Planning Rules (Repo-wide)

When writing an implementation plan for this project:

- Do **not** include optional branches or "nice-to-haves" (no "optional", "maybe", "could", "either/or").
- If multiple approaches are plausible, ask questions first and wait for answers before finalizing the plan.
- If any requirement is ambiguous, ask clarifying questions instead of assuming or adding alternatives.
- Write a single, deterministic plan with concrete deliverables (what changes, where, and what "done" means).

## Agent Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       Chrome Browser                          │
│                                                              │
│  ┌────────────────┐  executeScript    ┌──────────────────┐  │
│  │ Side Panel Agent│ ─────────────>  │   Page Agent      │  │
│  │ (sidepanel.js)  │                  │  (injected.js)    │  │
│  │                │ <─────────────── │                    │  │
│  │                │  runtime messages │  ┌──────────────┐ │  │
│  └────────────────┘                  │  │ Observer Agent│ │  │
│         │                             │  │(MutationObs) │ │  │
│         │ chrome.tabs                 │  └──────────────┘ │  │
│         v                             └──────────────────┘  │
│  ┌────────────────┐                                          │
│  │ Background Agent│                                          │
│  │ (background.js) │                                          │
│  └────────────────┘                                          │
└──────────────────────────────────────────────────────────────┘
```

## 1. Side Panel Agent (`sidepanel.js`)

**Role:** User-facing controller. Handles all interaction between the user and the extension. Replaces the former Popup Agent and Overlay Agent — all UI now lives in the side panel.

**Responsibilities:**
- Validates the active tab is an Instagram Reels page
- Reads follower count from the page via `chrome.scripting.executeScript`
- Displays stats (follower count, 5x threshold) in the side panel
- Manages the Run/Reset button state
- Injects the Page Agent (`injected.js`) on user command
- Triggers reset by calling `window.__outliers_reset()` on the page
- Listens for runtime messages from the Page Agent and renders progress, results, and errors
- Rehydrates UI from `window.__outliers_state` when the panel is opened/reopened

**Lifecycle:**
1. User clicks extension icon → side panel opens
2. Side panel reads active tab URL and validates it
3. Checks for persisted state (`window.__outliers_state`) on the page
4. If state exists: renders it immediately (rehydration)
5. If no state: reads follower count and displays stats
6. Waits for user to click Run or Reset
7. On Run: injects `injected.js` into the tab, listens for messages
8. On Reset: calls the page's reset function, clears UI

**Communication:**
- **Outbound:** `chrome.scripting.executeScript` to inject functions/files into the page
- **Inbound:** `chrome.runtime.onMessage` for live progress/results/errors from the Page Agent; return values from `executeScript` for follower count and state rehydration
- **API access:** `chrome.tabs.query` to get the active tab

**Constraints:**
- Cannot access page DOM directly (runs in extension context)
- Functions sent via `executeScript` must be self-contained (no closures)
- Must handle cases where script injection fails (wrong page, permissions)

## 2. Page Agent (`injected.js`)

**Role:** Core engine. Runs inside the Instagram page context with full DOM access. Produces **zero on-page UI** — all display is handled by the Side Panel Agent.

**Responsibilities:**
- Validates the page URL matches the Reels tab pattern
- Extracts follower count (3 fallback strategies)
- Auto-scrolls through the Reels grid to load all tiles
- Parses view counts from Reel thumbnails (4-tier strategy)
- Applies the 5x filter: `views >= followers * 5`
- Sorts qualifying Reels by view count (descending)
- Hides non-qualifying tiles via CSS class
- Maintains `window.__outliers_state` (serializable JSON) for side panel rehydration
- Sends runtime messages to the side panel on progress, completion, error, and reset
- Starts Observer Agent for ongoing tile monitoring
- Exposes `window.__outliers_reset()` for cleanup

**Lifecycle:**
1. Injected by Side Panel Agent via `executeScript`
2. Detects page type and sets state to `scanning`
3. Enters scroll phase: scrolls 600px every 800ms, accumulates tiles in a Map, emits progress messages
4. Scroll stops after 8 non-productive rounds or 500 attempts
5. Enters analysis phase: reads followers, filters and sorts accumulated Reels
6. Hides non-qualifying tiles, starts Observer Agent
7. Sets state to `done` with sorted outliers, emits completion message
8. Remains active until reset is called

**Data Structures:**
- `Map<url, {url, views}>` — accumulated Reels (survives DOM recycling)
- `window.__outliers_state` — serializable state (status, followers, threshold, scannedCount, outliers, errorText)
- Generation counter (`_runGeneration`) — prevents stale async callbacks

**Communication:**
- **Inbound:** Injected by Side Panel Agent; reset triggered via `window.__outliers_reset()`
- **Outbound:** `chrome.runtime.sendMessage` with `outliers:state` (progress/done/error) and `outliers:reset` messages; starts Observer Agent (MutationObserver)

## 3. Observer Agent (MutationObserver inside `injected.js`)

**Role:** Reactive sentinel. Monitors the DOM for changes caused by Instagram's virtual scrolling and applies filtering rules to newly loaded tiles.

**Responsibilities:**
- Watches the Reels grid container for child additions/removals
- Detects newly loaded tile elements from Instagram's infinite scroll
- Applies `.outliers-hidden` class to non-qualifying tiles
- Throttled via `requestAnimationFrame` to avoid layout thrashing

**Lifecycle:**
1. Created by Page Agent after initial filter/sort completes
2. Observes DOM mutations continuously
3. On each mutation batch (throttled to 1x per frame):
   - Scans new tiles for view counts
   - Compares against threshold
   - Hides non-qualifying tiles
4. Disconnected during reset

**Communication:**
- **Inbound:** Receives threshold and filter criteria from Page Agent
- **Outbound:** Modifies DOM (adds/removes CSS classes on tiles)

**Why it exists:** Instagram recycles and replaces DOM elements as the user scrolls. Without this agent, tiles that load after the initial scan would appear unfiltered.

## 4. Background Agent (`background.js`)

**Role:** Minimal service worker that configures the extension's toolbar icon to open the side panel.

**Responsibilities:**
- Calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` on startup

**Lifecycle:** Runs once when the service worker starts. No ongoing processing.

## Message Protocol

The Page Agent and Side Panel Agent communicate via `chrome.runtime.sendMessage`:

| Message type | Direction | Payload |
|---|---|---|
| `outliers:state` | Page → Side Panel | Full `OutliersState` snapshot (status, followers, threshold, scannedCount, outliers, errorText) |
| `outliers:reset` | Page → Side Panel | (no payload — signals state cleared) |

The Side Panel Agent also reads `window.__outliers_state` directly via `executeScript` for rehydration when opened after the scan is already in progress or complete.

## Agent Communication Flow

```
User clicks "Run"
       │
       v
  Side Panel Agent
       │
       ├── validates tab URL
       ├── reads followers via executeScript
       ├── displays stats in side panel
       └── injects injected.js
              │
              v
         Page Agent
              │
              ├── validates page URL
              ├── sets state: scanning → emits message
              ├── auto-scrolls (accumulates tiles in Map)
              ├── emits progress messages
              ├── filters: views >= followers * 5
              ├── sorts: descending by views
              ├── hides non-qualifying tiles
              ├── sets state: done → emits message
              └──> Observer Agent (monitors new tiles)

User clicks "Reset"
       │
       v
  Side Panel Agent
       │
       └── calls window.__outliers_reset()
              │
              v
         Page Agent
              │
              ├── disconnects Observer Agent
              ├── unhides all tiles (removes .outliers-hidden)
              ├── clears window.__outliers_state
              ├── emits outliers:reset message
              └── cleans up all state
```

## Key Design Decisions

**Why side panel instead of popup?**
Popups close when the user clicks away, losing all state. The side panel persists across interactions, allowing the user to see progress and results while interacting with the Instagram page. It also removes the need for any on-page overlay UI.

**Why zero on-page UI?**
Moving all UI to the side panel eliminates CSS conflicts with Instagram, removes Shadow DOM complexity, and provides a cleaner user experience. The page only receives tile hiding (CSS class toggling) — no overlays, progress indicators, or error messages are injected.

**Why runtime messaging + window state?**
Runtime messages provide live updates while the side panel is open. `window.__outliers_state` provides persistence for when the panel is closed and reopened — the side panel can fully reconstruct its view from this state alone without re-running the scan.

**Why a Map for tile accumulation?**
Instagram's virtual scrolling recycles DOM elements. A Map keyed by Reel URL ensures each Reel is counted exactly once, even if its DOM element is destroyed and recreated during scrolling.

**Why generation counters?**
If the user triggers a reset and re-run quickly, stale async callbacks from the previous run could corrupt the new run's state. The generation counter lets stale callbacks detect they're obsolete and exit cleanly.
