# Outliers — Roadmap

> For each feature below, create a **new Conductor workspace** to develop it in isolation.

---

## v1 — MVP (DONE)

- [x] Chrome extension (Manifest V3), vanilla JS, no build step
- [x] Read follower count from profile page
- [x] Read view counts from Reels grid thumbnails
- [x] Filter by 5x rule (`views >= followers * 5`)
- [x] Sort qualifying Reels by views (descending)
- [x] Shadow DOM overlay with outlier list, ratios, copy-link
- [x] Hide non-qualifying tiles
- [x] Auto-scroll to load Reels + MutationObserver for incremental filtering
- [x] Full reset (unhide tiles, remove overlay, stop observers)
- [x] Popup UI with Run / Reset controls + progress indicators

---

## v2 — Next Features

### Bug Fixes (Priority)
- [ ] **Fix warning system validation** — Currently executing actions instead of validating user is on correct tab first. After recent update, stopped working properly. System should:
  - Validate user is on the correct tab BEFORE executing any actions
  - Show warnings when user is not on the right step/page
  - NOT auto-execute when validation fails
  - Only proceed with actions after successful tab/page validation

### Scan Customization
- [ ] Let user choose how many reels to scan (e.g. 50, 100, 200)
- [ ] Time-based filtering — only show reels from last 3 / 6 / 12 months

### Minimum Views Filter
- [ ] Separate standalone filter (independent of the 5x rule)
- [ ] Let user specify a minimum view count threshold (e.g. 10,000)
- [ ] Show only Reels with views >= the user-specified threshold
- [ ] Add input field to popup UI for entering the minimum views value
- [ ] Can be used on its own without running the 5x outlier filter

### Sorting Options
- [ ] Sort by number of comments
- [ ] Sort by number of likes

### UI Overhaul
- [ ] Sidebar panel instead of overlay (better UX for browsing results)

### Review Request (Early Onboarding)
- [ ] Ask for Chrome Web Store review early — right after first successful scan (user is on emotional high)
- [ ] Position BEFORE any upsells or advanced features
- [ ] Rationale: highest conversion when user feels the "win"

---

## Future Ideas (unscoped)

- [ ] Adjustable multiplier (let user change from 5x to any value)
- [ ] Export outliers to CSV
- [ ] Chrome Web Store listing + privacy disclosure
- [ ] Multi-profile comparison
