# Chrome Web Store: Outliers 1.2.0

1.2.0 replaces the live 1.1.1. Permissions are unchanged, so the update installs silently. The listing changes are the description's "What's new in 1.2" and two Privacy practices answers, because 1.2 keeps finished scans in `chrome.storage.session` and no longer saves the Show and Sort picks.

## What's new

- The side panel always opens on 5× Outliers, sorted by Views, highest first.
- Each count shows once on a card: the sorted metric is the headline, with no repeated chip.
- In Instagram's Reel viewer, the Outliers bar shows views, likes, comments and the multiple, plus a Save button that adds the video to the Library.
- A finished scan is kept for the tab, so it comes back after visiting another profile or reloading. Reset or closing the tab deletes it.
- The panel says why when a scan can't start or Run is held back.

## Store listing

Summary, name, category, screenshots, tiles and video are unchanged from 1.1.1.

**Description:**

> Research your competition in seconds. Outliers is a free Chrome extension that finds the videos that broke out on any Instagram or TikTok profile, yours or anyone else's.
>
> Open a profile, click Run, and Outliers scrolls the grid for you and lists every video with its numbers:
>
> • Sort by views, likes, comments, engagement rate or views ÷ followers, highest or lowest first
> • On TikTok, also sort by shares, saves, post date and video length
> • Show only the outliers (5× more views than the account has followers), only videos over a view count you choose, or all of them
> • Change the filter or the sort after a scan; results update instantly, no rescanning
> • See the sorted videos as a grid of cards right on the profile, and in a side panel with Open, Copy link and Save
> • Export to CSV with every metric for Google Sheets or Excel
> • Keep a Library of videos you want to study
> • Share a Story card of the top 5, or copy a caption and links
>
> Works on Instagram Reels and TikTok profiles. TikTok access is optional: Chrome asks once, the first time you use it.
>
> Private by design: everything runs in your browser. Outliers has no servers, no accounts, no analytics and no tracking. It reads only what the profile page already shows you.
>
> Free, with the code on GitHub: https://github.com/RostyslavDzhohola/free-sort-feed-extension
>
> What's new in 1.2
> • Opens on 5× Outliers sorted by Views, so the breakout videos are the first thing you see
> • In Instagram's Reel viewer, the Outliers bar shows views, likes, comments and the multiple, with a Save button for your Library
> • Leave a profile and come back: your finished scan is still there
> • Each number shows once on a card, with the one you sort by as the headline
> • When a scan can't start, the panel tells you why
>
> What's new in 1.1
> • Sort by likes, comments, shares, saves, engagement, date and more (you asked for it!)
> • TikTok support
> • "All" view: every scanned video, sorted
> • Exact counts where the page provides them; Min Views no longer needs a follower count
> • Step through your sorted videos in Instagram's own Reel viewer, with arrows or the ← → keys
> • The panel stays on the tab you opened it on and hides on your other tabs
> • "Suggested for you" no longer pushes the results down

## Privacy practices

Single purpose, remote code, the other permission justifications, the three certifications and the privacy policy URL are unchanged from 1.1.1.

**`storage` justification:**

> Saves the user's settings (scan limit and Min Views) and the videos they choose to keep in their Library, locally on the device. Also keeps the user's finished scans for the open tab in Chrome's in-memory session storage, so a scan comes back when they return to that profile; these are deleted when they press Reset, close the tab or quit Chrome.

**Data usage, "Website content: yes":**

> When the user runs a scan, Outliers reads the profile page's public video data (video links, cover images, view, like, comment, share and save counts, post dates, lengths, and the follower count) to list and sort them. It processes this only in the user's browser. Videos the user saves to the Library, and the user's settings, are kept in the extension's local storage on their device (`chrome.storage.local` for the Library, the extension's own `localStorage` for settings). Finished scans are kept in `chrome.storage.session`, which Chrome holds in memory, until the user presses Reset, closes the tab or quits Chrome. None of this data is sent to the developer or anyone else.

All other data-usage answers stay "no".

## Notes for submission

- No new permissions or host permissions.
- If a reviewer asks about the Save button over Instagram's viewer: it's drawn by the scanner already on the page, and it sends the shown video's public counts to the extension's side panel, which adds it to the Library in `chrome.storage.local`. No network requests.

## Dashboard changes needed

- Store listing: description (adds "What's new in 1.2" above "What's new in 1.1").
- Privacy practices: the `storage` permission justification and the "Website content" data-usage answer, both as above.

## Website impact

None
