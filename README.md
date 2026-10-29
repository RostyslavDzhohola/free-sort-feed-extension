# Outliers

A free Chrome extension for researching short-form video; its code is all here. Open any Instagram or TikTok profile, yours or a competitor's, and Outliers lists its videos sorted by the numbers that matter: views, likes, comments, shares, saves, engagement rate, views ÷ followers, post date or length. Or keep only the outliers: videos with 5× more views than the account has followers.

## What It Does

On an Instagram profile's **Reels** tab, or a TikTok profile's **Videos** tab, the extension:

1. Reads the profile's **follower count**
2. Scrolls the grid and collects every video's numbers (see [What Outliers can read](#what-outliers-can-read))
3. Locks page interaction while scanning (transparent green safety layer)
4. Shows the videos you picked, in the order you picked, in Chrome's side panel and as a grid of cards on the page
5. Lets you change **Show** and **Sort by** afterwards without scanning again

Closing and reopening the side panel keeps your results until you reset.

## What Outliers can read

Outliers reads only what the profile page already loaded. Counts come from the page's own data, so they're exact; if that data isn't there, it falls back to the rounded numbers on the tiles.

| | Instagram Reels | TikTok videos |
|---|---|---|
| Views | ✓ | ✓ |
| Likes | ✓ (— when the creator hides them) | ✓ |
| Comments | ✓ | ✓ |
| Shares | — | ✓ |
| Saves | — | ✓ |
| Post date | — | ✓ |
| Length | — | ✓ |
| Engagement rate, views ÷ followers | ✓ (computed) | ✓ (computed) |

Unknown values show as "—" and sort last in either direction. It works the same on your own profile and on anyone else's.

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

1. Open an Instagram profile's **Reels** tab (`instagram.com/username/reels/`) or a TikTok profile (`tiktok.com/@username`)
2. Click the extension icon in your toolbar; a **side panel** opens with the profile, its followers and the active threshold
   - On a profile's main grid the panel offers **Open Reels tab**
   - The first time you use TikTok, click **Turn on TikTok**. Chrome asks once for access to tiktok.com. Instagram users never see this prompt.
3. Pick a **Scan limit**: **1 → 100 → 150 → 200 → 500 → All**, in **25-video** steps between 500 and 975
4. Pick what to **Show**:
   - **5× Outliers** (default): views ≥ followers × 5
   - **Min Views**: views ≥ a number you choose (1,000 to 1,000,000, log-scale slider)
   - **All**: every scanned video
5. Pick **Sort by** and its direction: Views, Likes, Comments, Engagement rate, Views ÷ followers; on TikTok also Shares, Saves, Post date and Length
6. Click **Run Outliers Scan**. Progress and partial results stream in while it scrolls; **Stop** finalizes from what was collected so far
7. Change **Show** or **Sort by** at any time. The panel list and the page grid update at once, without a rescan
8. Each result has **Open**, **Copy link** and **Save**. Clicking a card on the page opens Instagram's own Reel viewer over the grid; TikTok videos open in a new tab
9. **CSV** downloads the list with every metric (Google Sheets and Excel friendly). The first eight columns match 1.0.x exports, so existing sheets keep working
10. **Copy** and **Share** (Story card, caption, top 5 links) lead with the metric you sorted by
11. **Library** keeps saved videos across sessions, with their metrics, and exports them as CSV
12. **Reset** clears the scan and reloads the tab

The 5× filter needs the follower count; Min Views and All work without it.

## Development Workflow

### Watch mode with hot reload

```bash
pnpm watch
```

This starts esbuild in watch mode. On every `.ts` file save:
- esbuild rebuilds to `dist/` in ~20ms
- A background service worker (`hot-reload.js`) auto-detects the change and reloads the extension

The hot-reload service worker is **only included in watch mode**. Production builds (`pnpm build`) do not include it.

After the extension auto-reloads, you still need to **reopen the side panel** or **refresh the page** to see your changes.

### Available commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Production build to `dist/` (no hot reload) |
| `pnpm watch` | Watch mode + hot reload service worker |
| `pnpm typecheck` | Type-check with `tsc --noEmit` |
| `pnpm lint` | Run ESLint |
| `pnpm clean` | Remove `dist/` |
| `node --test test/*.test.mjs` | Unit tests for the shared logic |

### Full check before committing

```bash
pnpm typecheck && pnpm lint && node --test test/*.test.mjs && pnpm build
```

### Packaging for the Chrome Web Store

```bash
pnpm build
cd dist && zip -r ../outliers-$(node -p "require('../package.json').version").zip . -x '*.map'
```

## Conductor Setup

This project includes a `conductor.json` for use with [Conductor](https://conductor.build):

- **Setup script** (`pnpm install && pnpm build`): Runs automatically when a new workspace is created — installs deps and produces a ready-to-load `dist/`
- **Run script** (`pnpm watch`): Click the "Run" button in Conductor to start watch mode with hot reload
- **Spotlight**: Use Conductor's Spotlight feature to sync workspace changes back to the repo root for testing. When spotlighted, changes are copied to the root directory in real-time. Turn off spotlight to restore the original state.

## Project Structure

```
src/
├── sidepanel.html      — Side panel UI
├── sidepanel.ts        — Side panel logic (tab binding, readiness, Show/Sort, results, Library, CSV, share)
├── background.ts       — Background service worker (opens side panel on icon click)
├── injected.ts         — Scanner, isolated world (scrolling, per-platform tile readers, in-page grid)
├── page-bridge.ts      — Page-world reader for exact counts (Instagram Relay store, TikTok React props)
├── hot-reload.ts       — Dev-only: auto-reload service worker
├── manifest.json       — Chrome Extension config (Manifest V3)
├── types/
│   ├── globals.d.ts    — Window.__outliers_* type augmentation
│   └── state.ts        — OutliersState, OutliersEntry, ViewSettings and message types
└── shared/
    ├── platform.ts     — Instagram/TikTok URL parsing and wording
    ├── videos.ts       — Metrics, filtering, sorting and formatting
    ├── read-profile.ts — Self-contained profile + follower reader (run via executeScript)
    ├── bridge.ts       — Scanner ↔ page bridge event protocol
    ├── export-csv.ts   — Results and Library CSV
    ├── empty-state-copy.ts
    └── parse-count.ts  — "1.2K" / "1,2M" / "1,234" parsing
test/                   — node:test suites for src/shared
store/                  — Chrome Web Store listing, privacy and permission texts
dist/                   — Build output (Chrome loads this)
icons/                  — Extension icons (16, 48, 128px)
esbuild.mjs             — Build script
```

## Architecture

**Key design decisions:**
- **TypeScript** with **esbuild**: strict types, fast builds
- **IIFE output**: required for `executeScript` injection
- **No frameworks**: vanilla TypeScript, zero runtime dependencies
- **Manifest V3** with minimal permissions (`scripting`, `sidePanel`, `storage`), Instagram host access, and TikTok as an **optional** host permission requested only when you turn it on
- **Chrome Side Panel** for persistent controls + results
- **100% local**: no data leaves the browser

### Where the numbers come from

The scanner runs in the extension's isolated world, where it can talk to the side panel but can't see the page's JavaScript. A small page-world bridge can; the scanner asks it for exact counts over a DOM event and gets JSON back. The bridge only reads.

- **Instagram**: media records in the page's Relay store (`play_count`, `like_count`, `comment_count`, `like_and_view_counts_disabled`), keyed by shortcode. Fallback: the tile's view label and its hidden likes/comments overlay.
- **TikTok**: each grid tile's React props carry the video's `stats` (plays, likes, comments, shares, saves), `createTime` and `video.duration`. Fallback: the tile's view count.
- **Followers**: the user record named by the URL (Instagram Relay store `follower_count`, TikTok `stats.followerCount`), so it works in any language; fallbacks are the English "N followers" header text and `og:description`. Ownership is checked against the profile header, so SPA navigation never shows the previous profile's count.

## Privacy

- No data is collected, stored remotely, or transmitted
- All processing happens locally in your browser tab
- No remote servers, no analytics, no tracking
- Outliers only runs on a page when you open the side panel there; it reads Instagram, and TikTok once you allow it
- Saved videos stay in `chrome.storage.local` on your device

## Limitations

- Instagram's profile grid doesn't include shares, saves, post date or length, so those sorts are TikTok-only
- Saved videos are stored per device; no sync
- Thumbnails in the Library come from the platforms' signed image links and can expire; the video link keeps working
- Works only on Chrome/Chromium browsers
- Requires the grid and counts to be visible (respects login walls)

## License

Free to use. The source is on [GitHub](https://github.com/RostyslavDzhohola/free-sort-feed-extension).

---

## PS

The mascot icon for this extension was generated using a custom Claude Code skill (`snapai-icon-generator`) that wraps the [SnapAI CLI](https://codewithbeto.dev/tools/snapAI). The skill lets you describe what you want in natural language, and Claude crafts an optimized prompt, selects the right model/style/quality options, and runs the CLI, all from within your coding environment. It's been very useful for quickly iterating on icon designs without leaving the terminal.

I'd like to publish this skill to the Claude Code skills marketplace so others can use it too. If you know how to do that, or if Anthropic has published a guide for submitting community skills, please share!
