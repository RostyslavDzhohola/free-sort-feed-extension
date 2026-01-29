# Agents.md — Internal Architecture

This document describes the Chrome extension's internal components as cooperating "agents", each with a distinct role, lifecycle, and communication pattern.

## Agent Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Browser                        │
│                                                         │
│  ┌──────────────┐    executeScript     ┌─────────────┐  │
│  │  Popup Agent  │ ──────────────────> │  Page Agent  │  │
│  │  (popup.js)   │                     │ (injected.js)│  │
│  │              │ <────────────────── │              │  │
│  │              │   result callback    │  ┌────────┐ │  │
│  └──────────────┘                     │  │Observer│ │  │
│         │                              │  │ Agent  │ │  │
│         │ chrome.tabs                  │  └────────┘ │  │
│         v                              │  ┌────────┐ │  │
│  ┌──────────────┐                     │  │Overlay │ │  │
│  │  Tab Agent    │                     │  │ Agent  │ │  │
│  │ (Chrome API)  │                     │  └────────┘ │  │
│  └──────────────┘                     └─────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 1. Popup Agent (`popup.js`)

**Role:** User-facing controller. Handles all interaction between the user and the extension.

**Responsibilities:**
- Validates the active tab is an Instagram Reels page
- Reads follower count from the page via `chrome.scripting.executeScript`
- Displays stats (follower count, 5x threshold) in the popup UI
- Manages the Run/Reset button state toggle
- Injects the Page Agent (`injected.js`) on user command
- Triggers reset by calling `window.__reels5x_reset()` on the page

**Lifecycle:**
1. User clicks extension icon → popup opens
2. Popup reads active tab URL and validates it
3. Executes `readFollowersFromPage()` in the page context
4. Displays follower count and threshold
5. Waits for user to click Run or Reset
6. On Run: injects `injected.js` into the tab
7. On Reset: calls the page's reset function

**Communication:**
- **Outbound:** `chrome.scripting.executeScript` to inject functions/files into the page
- **Inbound:** Return values from executed scripts (follower count, status)
- **API access:** `chrome.tabs.query` to get the active tab

**Constraints:**
- Cannot access page DOM directly (runs in extension context)
- Functions sent via `executeScript` must be self-contained (no closures)
- Must handle cases where script injection fails (wrong page, permissions)

## 2. Page Agent (`injected.js`)

**Role:** Core engine. Runs inside the Instagram page context with full DOM access.

**Responsibilities:**
- Validates the page URL matches the Reels tab pattern
- Extracts follower count (3 fallback strategies)
- Auto-scrolls through the Reels grid to load all tiles
- Parses view counts from Reel thumbnails (4-tier strategy)
- Applies the 5x filter: `views >= followers * 5`
- Sorts qualifying Reels by view count (descending)
- Delegates display to the Overlay Agent and monitoring to the Observer Agent
- Exposes `window.__reels5x_reset()` for cleanup

**Lifecycle:**
1. Injected by Popup Agent via `executeScript`
2. Detects page type and reads follower count
3. Enters scroll phase: scrolls 600px every 800ms, accumulates tiles in a Map
4. Scroll stops after 8 non-productive rounds or 500 attempts
5. Enters analysis phase: filters and sorts accumulated Reels
6. Enters display phase: hides non-qualifying tiles, renders overlay
7. Starts Observer Agent for ongoing monitoring
8. Remains active until reset is called

**Data Structures:**
- `Map<url, {url, views, tileElement}>` — accumulated Reels (survives DOM recycling)
- Generation counter (`_runGeneration`) — prevents stale async callbacks

**Communication:**
- **Inbound:** Injected by Popup Agent; reset triggered via `window.__reels5x_reset()`
- **Outbound:** Creates Overlay Agent (Shadow DOM); starts Observer Agent (MutationObserver)

## 3. Observer Agent (MutationObserver inside `injected.js`)

**Role:** Reactive sentinel. Monitors the DOM for changes caused by Instagram's virtual scrolling and applies filtering rules to newly loaded tiles.

**Responsibilities:**
- Watches the Reels grid container for child additions/removals
- Detects newly loaded tile elements from Instagram's infinite scroll
- Applies `.reels5x-hidden` class to non-qualifying tiles
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

## 4. Overlay Agent (Shadow DOM panel inside `injected.js`)

**Role:** Display renderer. Presents the filtered and sorted results to the user in an isolated UI panel.

**Responsibilities:**
- Renders a fixed-position panel (top-right corner) using Shadow DOM
- Displays: follower count, threshold, outlier count
- Shows a scrollable ranked list of qualifying Reels with:
  - Rank number (#1, #2, ...)
  - View count
  - Ratio (views / followers)
  - "Open" button (new tab)
  - "Copy link" button (clipboard)
- Provides visual feedback for clipboard operations

**Lifecycle:**
1. Created by Page Agent after filtering completes
2. Renders once with the full sorted results
3. Remains visible until reset
4. Removed during reset (Shadow DOM host element removed from page)

**Communication:**
- **Inbound:** Receives sorted Reels array and stats from Page Agent
- **Outbound:** User interactions (open link, copy to clipboard)

**Why Shadow DOM:** Instagram's CSS is aggressive and changes frequently. Shadow DOM provides complete style isolation so the overlay renders consistently regardless of Instagram's styling.

## Agent Communication Flow

```
User clicks "Run"
       │
       v
  Popup Agent
       │
       ├── validates tab URL
       ├── reads followers via executeScript
       ├── displays stats in popup
       └── injects injected.js
              │
              v
         Page Agent
              │
              ├── validates page URL
              ├── reads followers (3 strategies)
              ├── auto-scrolls (accumulates tiles in Map)
              ├── filters: views >= followers * 5
              ├── sorts: descending by views
              │
              ├──> Overlay Agent (renders sorted results)
              └──> Observer Agent (monitors new tiles)

User clicks "Reset"
       │
       v
  Popup Agent
       │
       └── calls window.__reels5x_reset()
              │
              v
         Page Agent
              │
              ├── disconnects Observer Agent
              ├── removes Overlay Agent (Shadow DOM)
              ├── unhides all tiles (removes .reels5x-hidden)
              └── cleans up all state
```

## Key Design Decisions

**Why separate agents instead of one monolith?**
Each component has a distinct lifecycle and failure mode. The Observer Agent can fail without affecting the Overlay Agent. The Popup Agent operates in a different execution context entirely (extension vs. page).

**Why a Map for tile accumulation?**
Instagram's virtual scrolling recycles DOM elements. A Map keyed by Reel URL ensures each Reel is counted exactly once, even if its DOM element is destroyed and recreated during scrolling.

**Why generation counters?**
If the user triggers a reset and re-run quickly, stale async callbacks from the previous run could corrupt the new run's state. The generation counter lets stale callbacks detect they're obsolete and exit cleanly.
