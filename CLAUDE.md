# CLAUDE.md — Project Memory for Reels 5x Outlier Filter

## Project Overview

Chrome extension (Manifest V3) that filters Instagram Reels by the "5x rule": shows only Reels with `views >= followers * 5`. TypeScript with esbuild, no frameworks, minimal dependencies (dev-only).

## File Map

- `src/manifest.json` — MV3 config, permissions: `activeTab` + `scripting`
- `src/popup.html` + `src/popup.ts` — Extension popup UI and logic
- `src/injected.ts` — Core engine injected into Instagram pages (the main file)
- `src/types/globals.d.ts` — Window global augmentation (`__reels5x_active`, `__reels5x_reset`)
- `src/types/reel.ts` — Shared interfaces (`ReelData`, `QualifyingReel`)
- `src/shared/parse-count.ts` — Shared `parseCount()` + `formatCount()` utilities
- `icons/` — Extension icons
- `dist/` — Build output (Chrome loads this as unpacked extension)
- `esbuild.mjs` — Build script (compiles TS → IIFE JS bundles)
- `plan.md` — Original project specification

## Key Architecture Rules

- **TypeScript with esbuild.** Source in `src/`, compiled to `dist/` via `pnpm build`.
- **No frameworks.** Vanilla TypeScript only. No React, no UI frameworks.
- **Dev-only dependencies.** `typescript`, `esbuild`, `chrome-types`, `eslint`. Zero runtime dependencies.
- **Minimal permissions.** Only `activeTab` and `scripting`. No network access.
- **No data leaves the browser.** 100% local processing.

## Package Manager

- **Use `pnpm`** — the preferred package manager for this project. Always use `pnpm` instead of `npm` or `yarn`.

## Build Commands

- `pnpm build` — Compile TS to `dist/` (esbuild, IIFE format, source maps)
- `pnpm watch` — Watch mode for development
- `pnpm typecheck` — Type check with `tsc --noEmit` (esbuild does not type-check)
- `pnpm lint` — ESLint
- `pnpm clean` — Remove `dist/`

## TypeScript Conventions

- **Strict mode**: `strict: true` + `noUncheckedIndexedAccess` in tsconfig
- **Target**: ES2020 (Chrome extensions run in modern Chromium)
- **Output format**: IIFE (required — popup loads via `<script>`, injected.js via `executeScript`)
- **Chrome types**: Provided by `chrome-types` npm package (ambient `chrome.*` APIs)
- **Shared code**: `src/shared/` contains utilities imported by both entry points. esbuild inlines imports into each IIFE bundle.
- **Self-contained constraint**: `readFollowersFromPage()` in `popup.ts` is injected via `executeScript({ func })` and MUST remain self-contained — no imports, no closures. Its inline `parseCount()` intentionally duplicates `src/shared/parse-count.ts`.
- **Window globals**: Typed via `src/types/globals.d.ts` augmentation of the `Window` interface.

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
