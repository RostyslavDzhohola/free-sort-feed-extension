# Reels 5x Outlier Filter

A free Chrome extension that helps Instagram creators identify "outlier" Reels — videos whose views significantly exceed the creator's follower count.

## What It Does

On any Instagram profile's Reels tab, the extension:

1. Reads the creator's **follower count** from the profile page
2. Computes a threshold: `followers x 5`
3. Scrolls through all Reels and reads their **view counts**
4. **Hides** Reels below the threshold
5. Shows a **sorted overlay panel** of qualifying Reels (highest views first)

This lets creators quickly spot which content "breaks out" relative to audience size.

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
2. Click the extension icon in your toolbar
3. The popup shows the detected **follower count** and **5x threshold**
4. Click **Run 5x Filter**
5. The extension auto-scrolls through Reels, then:
   - Hides non-qualifying tiles
   - Shows a floating panel with sorted outliers, their view counts, and `views / followers` ratio
6. Use **Open** or **Copy link** buttons to save interesting Reels
7. Click **Reset** to restore the original page

## Development Workflow

### Watch mode with hot reload

```bash
pnpm watch
```

This starts esbuild in watch mode. On every `.ts` file save:
- esbuild rebuilds to `dist/` in ~20ms
- A background service worker (`hot-reload.js`) auto-detects the change and reloads the extension

The hot-reload service worker is **only included in watch mode** — production builds (`pnpm build`) do not include it.

After the extension auto-reloads, you still need to **reopen the popup** or **refresh the Instagram tab** to see your changes.

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
├── popup.html          — Extension popup UI
├── popup.ts            — Popup logic (tab detection, follower reading, script injection)
├── injected.ts         — Core engine (scrolling, parsing, filtering, overlay)
├── hot-reload.ts       — Dev-only: auto-reload service worker
├── manifest.json       — Chrome Extension config (Manifest V3)
├── types/
│   ├── globals.d.ts    — Window.__reels5x_* type augmentation
│   └── reel.ts         — ReelData, QualifyingReel interfaces
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
- **Manifest V3** with minimal permissions (`activeTab` + `scripting`)
- **Shadow DOM** overlay for CSS isolation from Instagram
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
