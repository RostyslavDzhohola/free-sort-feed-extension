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

## Installation

### From source (developer mode)

1. Clone this repo
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `porto/` directory
5. The extension icon appears in your toolbar

### From Chrome Web Store

*(Coming soon)*

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

## Architecture

See [Agents.md](./Agents.md) for a detailed breakdown of the extension's internal components and how they communicate.

**Files:**

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome Extension config (Manifest V3) |
| `popup.html` | Popup UI — button, stats display, styling |
| `popup.js` | Popup logic — tab detection, follower reading, script injection |
| `injected.js` | Core engine — scrolling, parsing, filtering, sorting, overlay rendering |
| `icons/` | Extension icons (16px, 48px, 128px) |
| `plan.md` | Original project specification |

## Technical Details

- **Manifest V3** compliant
- **Zero dependencies** — vanilla JavaScript, no build step
- **Minimal permissions** — only `activeTab` and `scripting`
- **100% local** — no data leaves your browser, no accounts, no backend
- **Shadow DOM** overlay to avoid CSS conflicts with Instagram

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

## Development

No build step required. Edit the JS/HTML files directly and reload the extension in `chrome://extensions/`.

To test changes:
1. Make edits to source files
2. Click the refresh icon on the extension card in `chrome://extensions/`
3. Navigate to an Instagram Reels page and test

## License

Free to use.
