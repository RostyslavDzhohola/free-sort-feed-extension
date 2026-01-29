# Plan: Instagram Reels “5× Rule” Sorter (Free Chrome Extension)

## 1) Goal (what we’re building)
Create a **free Chrome extension** that, on any Instagram creator’s **Profile → Reels** page, will:

1. Read the creator’s **follower count**
2. Read each Reel’s **view count**
3. Compute a threshold: `threshold = followers × 5`
4. **Show only** Reels with `views >= threshold`
5. **Sort** those “outlier” Reels **highest → lowest views**

Primary user: creators researching what content “breaks out” relative to a creator’s audience size.

## 2) MVP scope (avoid feature creep)

### In scope (v1)
- Works on `instagram.com/<username>/reels/` (and equivalent Reels tab routes Instagram uses).
- Multiplier is fixed at **5×** (the “5× rule”) in v1 (not user-adjustable).
- Filters out non-qualifying Reels and presents qualifying Reels sorted by views (descending).
- Runs fully **locally**: no accounts, no backend, no database, no analytics.
- User-triggered: runs only when the user clicks the extension (does not auto-run on Instagram pages).
- Minimal UI: popup “Run/Reset” control + in-page overlay list of outliers.

### Explicitly out of scope (v1)
- Exporting to CSV/Sheets, saving projects/lists, syncing across devices.
- Any Instagram API scraping that requires reverse engineering query hashes or bypassing rate limits.
- Auto-scrolling to load all Reels.
- Multi-rule ranking (likes, comments, watch time), niche detection, “similar creators”, etc.
- Anything that sends data off-device.

### Success criteria
- On ≥ 10 public profiles (mixed sizes), the extension:
  - detects followers and threshold correctly,
  - identifies the same outliers as a manual check,
  - keeps the page usable (no broken scrolling / layout),
  - sorts outliers correctly (largest views first).
- Passes Chrome Web Store (CWS) review with **minimal permissions** and clear privacy disclosure.

## 3) Key constraints (research findings)

### Instagram UI + DOM volatility
Instagram is a React single-page app (SPA). Markup and class names change frequently. We should avoid brittle CSS selectors and prefer:
- stable attributes (ARIA labels, `href` patterns, semantics),
- “structure + text” heuristics,
- fallbacks (multiple strategies) and graceful failure UI.

### Logged-out viewing is controlled by Instagram
Instagram sometimes shows a login wall or limits profile access when logged out. The extension won’t (and shouldn’t) bypass that; it can only operate when the Reels grid and counts are present in the page.

### SPA navigation must not leave the page in a broken state
Moving between profiles and tabs often happens without a full page reload. The extension must cleanly reset its changes on navigation (or require the user to click “Run” again for the new profile).

### View counts may not always be available
Some creators hide engagement metrics, and Instagram sometimes changes what’s displayed on thumbnails. If view counts are missing/unparseable, the extension must:
- show a clear “Can’t read views on this profile” message,
- disable sorting/filtering instead of producing wrong results.

### CWS / Manifest V3 requirements (important)
- Ship as **Manifest V3**.
- **No remote code** (everything bundled in the extension package).
- Request the **minimum** permissions/host access needed.
- Follow Chrome Web Store **User Data** and **Limited Use** policy expectations (even if you collect nothing, you must be explicit about it).

## 4) Technical approach (deterministic)

### 4.1 Data extraction strategy
We need two numbers: `followers` and per-Reel `views`.

**Followers (preferred order):**
1. Parse `meta[property="og:description"]` on the profile page:
   - Commonly includes “X Followers, Y Following, Z Posts …” (works even when the page is partially gated).
2. Parse the profile header follower element in the DOM (often has a full number in an attribute like `title` even if abbreviated on-screen).
3. Fallback: show “Can’t read followers on this profile” and disable filtering/sorting.

**Views (v1):**
1. Parse the Reel thumbnail overlay count on the Reels grid (text like `123K`, `1.2M`, `2,345`, etc.).
2. Parse from:
   - ARIA labels on the tile/link, or
   - the link’s accessible name.
3. If views can’t be read for the profile, show “Can’t read views on this profile” and don’t filter/sort.

### 4.2 Number parsing (critical for correctness)
Implement a single conversion utility:
- Accept strings like `2,345`, `12.3K`, `1.2M`, `0.9B`, and common locale variations.
- Prefer “exact” numbers if available via attributes (e.g., `title="1,234,567"`).
- Output an integer.

### 4.3 Filtering + sorting UX (what “sort the page” means)
Directly reordering Instagram’s grid DOM can be fragile due to virtualization and rerenders.

**Chosen MVP UX (deterministic):**
- Keep Instagram’s grid as-is, but:
  - hide non-qualifying tiles (CSS class), and
  - inject a lightweight **“Outliers” overlay panel** (Shadow DOM) containing a sorted list of qualifying Reels:
    - views, `views ÷ followers` ratio, and a link to open the Reel,
    - a “Copy link” button for saving the Reel URL.

This still achieves the creator’s workflow (“show me only the outliers, highest to lowest”) while reducing breakage risk.

### 4.4 Handling infinite scroll / dynamic loading
Reels load as you scroll. Use:
- `MutationObserver` (watch the Reels grid container) to detect newly added tiles,
- incremental parsing (only process new tiles),
- re-run the sort/filter on the result set after each batch (throttled).

### 4.5 UI (keep it minimal)
On-page overlay should include:
- Detected followers + computed threshold
- Count of qualifying Reels
- Progress indicator (e.g., “scanned 24 tiles”)
- Sorted outlier list (views + ratio + open link + copy link)
- “Reset” button (removes filtering/UI)

## 5) Tooling choice (deterministic)
**Use a plain Manifest V3 Chrome extension with vanilla JavaScript/HTML/CSS (no framework, no build step).**

Why this is the fastest MVP path:
- Lowest setup overhead: no bundler, no dependency installation, no build config.
- Small code surface (popup + injected script) is easy to iterate on as Instagram UI changes.
- Simplest CWS submission story: no remote code, minimal moving parts, easy review.

Chosen permissions (minimal):
- `activeTab` + `scripting` (inject only after the user clicks the extension)

Chosen structure:
- `manifest.json` (MV3)
- `popup.html` + `popup.js` (Run/Reset button + basic status)
- `injected.js` (the logic that runs in the page: extract → filter → sort → overlay/hide)
- `icons/` (required for CWS)

## 6) Phased plan (build order)

### Phase 0 — Feasibility spike (0.5–1 day)
Goal: prove we can reliably read followers + views on real profiles.
- Inspect multiple profiles’ Reels pages and document:
  - URL patterns for Reels tab,
  - where follower count appears (meta vs DOM),
  - where views appear on thumbnails (text vs aria label vs hover-only).
- Prototype number parsing with a small set of real strings.

Deliverable: a short “selectors + parsing” note.

### Phase 1 — MVP extension (1–2 days)
Goal: working filter + sorted outlier list on Instagram Reels profile pages.
- Create MV3 extension skeleton (chosen structure in Section 5).
- Popup:
  - “Run 5× Filter” button that injects `injected.js` into the active tab via `chrome.scripting.executeScript`.
  - If the overlay already exists, button becomes “Reset” and removes changes.
- Injected page logic (`injected.js`):
  - detect if on a profile Reels page; otherwise show a message in the overlay (“Open a profile’s Reels tab”).
  - read follower count; if missing, show “Can’t read followers on this profile”.
  - scan Reels tiles → `{url, views, tileRef}`; if views missing, show “Can’t read views on this profile”.
  - compute `threshold = followers × 5`.
  - filter qualifying Reels where `views >= threshold` and sort desc.
  - hide non-qualifying tiles and render the overlay list:
    - views, ratio (`views ÷ followers`), “Open” link, “Copy link” button.

Deliverable: local installable extension folder + short README.

### Phase 2 — Reliability + polish (1–2 days)
Goal: handle real-world variability and keep it stable.
- Add robust fallbacks (followers from meta → DOM → show message).
- Improve parsing across locales (commas, spaces, non-breaking spaces).
- Handle SPA navigation: detect URL/page transitions and auto-reset so hidden tiles/overlays don’t persist across profiles.
- MutationObserver incremental updates for infinite scroll.
- Ensure “Reset” fully restores the page (unhide tiles, remove overlay, disconnect observers).
- Performance guardrails (throttle re-sorts, de-dupe reels by URL).

Deliverable: v1.0 candidate.

### Phase 3 — Publish (0.5–1 day)
Goal: ship it free.
- Icons, screenshots, store description.
- Privacy disclosure: “no data collected/sent”, explain on-page behavior.
- Ensure permissions are minimal (use `activeTab` injection and refuse to run unless the active tab is `instagram.com`).
- Package and publish to Chrome Web Store.

Deliverable: CWS listing + public repo release tag.

### Phase 4 — Maintenance (ongoing)
- Expect occasional breakage due to Instagram DOM changes.
- Keep selectors in a single module and version updates.
- Add an issue template: “profile URL + screenshot + what broke”.

## 7) Testing checklist (practical)
- Public profile, logged out (if Instagram allows viewing) vs logged in.
- Large follower counts (M+), small accounts (<10k), exact vs abbreviated.
- Profiles where view counts are missing/hidden.
- Infinite scroll: load more, confirm incremental filtering and stable sorting.
- Verify “reset” restores original page behavior.

## 8) Confirmed requirements (from you)
- Rule is `views >= followers × 5`.
- 5× is fixed (not adjustable in v1).
- Prioritize fastest MVP implementation; add capabilities later.
- Extension requires no sign-in/authentication and should work logged-in or logged-out.
- If view counts can’t be read, show “Can’t read views on this profile” and do nothing else.
- Do not auto-run: user clicks the extension popup to run/reset.
- Overlay should show `views ÷ followers` ratio and allow copying Reel links.

## 9) Reference links (for implementation)
- Chrome extension policies + MV3:
  - https://developer.chrome.com/docs/webstore/program-policies/
  - https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline
- Chrome extension APIs used:
  - https://developer.chrome.com/docs/extensions/reference/scripting/
  - https://developer.chrome.com/docs/extensions/reference/tabs/
