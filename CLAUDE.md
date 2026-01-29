# CLAUDE.md — Project Memory for Reels 5x Outlier Filter

## Project Overview

Chrome extension (Manifest V3) that filters Instagram Reels by the "5x rule": shows only Reels with `views >= followers * 5`. Vanilla JS, no build step, zero dependencies.

## File Map

- `manifest.json` — MV3 config, permissions: `activeTab` + `scripting`
- `popup.html` + `popup.js` — Extension popup UI and logic
- `injected.js` — Core engine injected into Instagram pages (24KB, the main file)
- `icons/` — Extension icons
- `plan.md` — Original project specification

## Key Architecture Rules

- **No build step.** Vanilla JS only. No bundler, no npm, no frameworks.
- **No external dependencies.** Everything is self-contained.
- **Minimal permissions.** Only `activeTab` and `scripting`. No network access.
- **No data leaves the browser.** 100% local processing.

## Coding Patterns and Conventions

### Chrome Extension Specifics
- Functions passed to `chrome.scripting.executeScript` must be **self-contained** (no closures over popup variables). This is a hard Chrome API constraint.
- `executeScript` resolves when the script *starts* executing, not when its internal logic completes. Handle failures gracefully in popup.
- Use **granular try-catch blocks** — avoid broad catches that hide root causes. Split to isolate potential failures, especially with async operations.
- Use `try-catch-finally` for event handlers that modify UI state. The `finally` block guarantees cleanup (e.g., re-enabling buttons) regardless of errors.

### DOM Interaction (Instagram-specific)
- **Never use generic selectors** like `closest("div")`. Use specific selectors: `closest("article")`, `closest('[role="button"]')`, `parentElement`.
- **Anchored regex for URL matching.** Use `^`, `$` and exclude subpaths (`/explore/`, `/p/`) to match intended page types precisely.
- Instagram is a React SPA that heavily **recycles DOM elements** during scrolling. Use `MutationObserver` with debouncing and accumulate elements in a Map to survive recycling.
- **Debounce MutationObserver with `requestAnimationFrame`** — ensures actions like `hideNonQualifyingTiles()` run at most once per frame, preventing layout thrashing.

### Async Patterns
- **Generation counters for race conditions.** Use a monotonically increasing `_runGeneration` counter captured at operation start. Stale callbacks self-terminate by comparing their generation to the current one.
- **Clipboard operations:** Always include `.catch()` for `navigator.clipboard.writeText()` and validate input before use.

### Error Handling
- Provide **specific error messages** (e.g., "Open an Instagram profile page first.") not generic "Something went wrong."
- A **single `resetAll()` function** handles all cleanup: removes overlay, unhides tiles, stops observers, cleans CSS, restores page state. Never do manual partial cleanup.
- **Silent error recovery is bad.** Errors in critical loops should be logged or surfaced to the user.

### UI Patterns
- Always keep buttons enabled after operations complete (use `finally`).
- Show progress indicators during long-running operations (scrolling, scanning).
- Overlay uses **Shadow DOM** for CSS isolation from Instagram.

## Performance Guardrails

- Auto-scroll: 600px steps, 800ms wait between scrolls
- Safety cap: max 500 scroll attempts, 8 consecutive non-productive scrolls triggers stop
- Tiles accumulated in a **Map** (keyed by URL) to deduplicate across virtual scroll recycling
- MutationObserver callbacks throttled via `requestAnimationFrame`

## Testing Checklist

- Public profiles: logged in and logged out
- Follower ranges: <10K, 100K+, 1M+
- Profiles with hidden/missing view counts
- Infinite scroll: load more tiles, verify incremental filtering
- Reset: verify full page restoration
- Rapid toggle: click Run/Reset quickly
- Tab closing during operation

## Mistakes to Avoid

- Broad `catch` blocks that hide root causes
- Manual cleanup without calling `resetAll()`
- Assuming `executeScript` means the injected function completed
- Over-reliance on generic DOM selectors (`closest("div")`)
- Forgetting to re-enable buttons after errors (use `finally`)
