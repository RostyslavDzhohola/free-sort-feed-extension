# Outliers

A free Chrome extension that helps Instagram creators identify "outlier" Reels — videos whose views significantly exceed the creator's follower count.

## What It Does

On any Instagram profile's Reels tab, the extension:

1. Reads the creator's **follower count** from the profile page
2. Computes a threshold: `followers x 5`
3. Scrolls through all Reels and reads their **view counts**
4. **Hides** Reels below the threshold on the page
5. Shows a **sorted results list** in Chrome's side panel (highest views first)

No on-page overlays — all UI lives in the side panel. Closing and reopening the panel preserves your results until you reset.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) package manager

## Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Build the extension
pnpm build

# 3. Load in Chrome
#    - Open chrome://extensions/
#    - Enable "Developer mode" (top-right toggle)
#    - Click "Load unpacked"
#    - Select the dist/ folder
```

## Usage

1. Navigate to an Instagram profile's **Reels** tab (e.g. `instagram.com/username/reels/`)
2. Click the extension icon in your toolbar — a **side panel** opens
3. The side panel shows the detected **follower count** and **5x threshold**
4. Click **Run Outliers Scan**
5. The extension auto-scrolls through Reels, showing live progress in the side panel, then:
   - Hides non-qualifying tiles on the page
   - Shows sorted outliers with view counts and `views / followers` ratio in the side panel
6. Use **Open** or **Copy link** buttons to save interesting Reels
7. Close and reopen the side panel — your results are preserved
8. Click **Reset** to restore the original page and clear results

## Development Workflow

### Watch mode with hot reload

```bash
pnpm watch
```

This starts esbuild in watch mode. On every `.ts` file save:
- esbuild rebuilds to `dist/` in ~20ms
- A background service worker (`hot-reload.js`) auto-detects the change and reloads the extension

The hot-reload service worker is **only included in watch mode** — production builds (`pnpm build`) do not include it.

After the extension auto-reloads, you still need to **reopen the side panel** or **refresh the Instagram tab** to see your changes.

### Available commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Production build to `dist/` (no hot reload) |
| `pnpm watch` | Watch mode + hot reload service worker |
| `pnpm typecheck` | Type-check with `tsc --noEmit` |
| `pnpm lint` | Run ESLint |
| `pnpm clean` | Remove `dist/` |

### Full check before committing

```bash
pnpm typecheck && pnpm lint && pnpm build
```

## Project Structure

```
src/
├── sidepanel.html      — Side panel UI
├── sidepanel.ts        — Side panel logic (tab detection, follower reading, script injection, results display)
├── background.ts       — Background service worker (opens side panel on icon click)
├── injected.ts         — Core engine (scrolling, parsing, filtering — zero on-page UI)
├── hot-reload.ts       — Dev-only: auto-reload service worker
├── manifest.json       — Chrome Extension config (Manifest V3)
├── types/
│   ├── globals.d.ts    — Window.__outliers_* type augmentation
│   ├── state.ts        — OutliersState, OutliersEntry, OutliersMessage types
│   └── reel.ts         — ReelData interface
└── shared/
    └── parse-count.ts  — Shared parseCount() + formatCount()

dist/                   — Build output (Chrome loads this)
icons/                  — Extension icons (16, 48, 128px)
esbuild.mjs             — Build script
conductor.json          — Conductor workspace scripts
```

## Conductor Setup

This project includes a `conductor.json` for use with [Conductor](https://conductor.build):

- **Setup script** (`pnpm install && pnpm build`): Runs automatically when a new workspace is created — installs deps and produces a ready-to-load `dist/`
- **Run script** (`pnpm watch`): Click the "Run" button in Conductor to start watch mode with hot reload
- **Spotlight**: Use Conductor's Spotlight feature to sync workspace changes back to the repo root for testing. When spotlighted, changes are copied to the root directory in real-time. Turn off spotlight to restore the original state.

## Architecture

See [Agents.md](./Agents.md) for a detailed breakdown of the extension's internal components.

**Key design decisions:**
- **TypeScript** with **esbuild** — strict types, fast builds, source maps
- **IIFE output** — required for Chrome extension popup scripts and `executeScript` injection
- **No frameworks** — vanilla TypeScript, zero runtime dependencies
- **Manifest V3** with minimal permissions (`scripting` + `sidePanel`) + Instagram-only host access
- **Chrome Side Panel** for persistent UI — no on-page overlays
- **100% local** — no data leaves the browser

### Follower Detection (3 fallback strategies)

1. `a[href*="/followers"]` link with title/span text
2. Profile header section scanning for "followers" text
3. `meta[property="og:description"]` content parsing

### View Count Parsing (4-tier priority)

1. ARIA labels on tile elements
2. SVG play icon + adjacent number text
3. Non-heart SVG adjacent numbers
4. Span text elements within tiles

### Number Format Support

Handles `2,345` | `12.3K` | `1.2M` | `0.9B` and locale variations.

## Privacy

- No data is collected, stored, or transmitted
- All processing happens locally in your browser tab
- No remote servers, no analytics, no tracking
- Extension only activates when you click it on an Instagram Reels page

## Limitations (v1)

- Multiplier is fixed at 5x (not adjustable)
- No CSV/Sheets export
- No cross-device sync
- Works only on Chrome/Chromium browsers
- Requires the Reels grid and counts to be visible (respects Instagram's login walls)

## License

Free to use.

---

## PS

The mascot icon for this extension was generated using a custom Claude Code skill (`snapai-icon-generator`) that wraps the [SnapAI CLI](https://codewithbeto.dev/tools/snapAI). The skill lets you describe what you want in natural language, and Claude crafts an optimized prompt, selects the right model/style/quality options, and runs the CLI — all from within your coding environment. It's been very useful for quickly iterating on icon designs without leaving the terminal.

I'd like to publish this skill to the Claude Code skills marketplace so others can use it too. If you know how to do that, or if Anthropic has published a guide for submitting community skills, please share!
