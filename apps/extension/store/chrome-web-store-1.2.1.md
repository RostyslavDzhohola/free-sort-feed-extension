# Chrome Web Store: Outliers 1.2.1

1.2.1 replaces 1.2.0 in review (1.2.0 was cancelled before approval); the live version is still 1.1.1. Permissions are unchanged, so the update installs silently.

## What's new

- Everything in 1.2.0 (see `chrome-web-store-1.2.0.md`).
- Clicking the Outliers icon in the toolbar again closes the side panel.

## Store listing

Unchanged from 1.2.0: the description with "What's new in 1.2" in `chrome-web-store-1.2.0.md` was saved in the dashboard on 2026-11-25 and stays in the draft.

## Privacy practices

Unchanged from 1.2.0. 1.2.1 adds no permissions, storage or data: the side panel and the background worker talk over an in-extension port (`chrome.runtime.connect`) so the icon knows whether the panel is open.

## Dashboard changes needed

None

## Website impact

None
