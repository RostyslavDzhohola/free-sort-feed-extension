# Chrome Web Store: Outliers 1.1.0 listing texts

Paste these into the Developer Dashboard for item `heogkfpbeagpoodininnfhdgjmpdalgj` when you submit 1.1.0. Sections follow the dashboard's tabs.

## Store listing

**Name:** Outliers

**Summary** (manifest `description`, 132 characters max; this one is 116):

> Find outlier videos on Instagram and TikTok. Sort any profile by views, likes, comments and more. Free, open source.

**Category:** Tools (unchanged)

**Description:**

> Research your competition in seconds. Outliers is a free, open source Chrome extension that finds the videos that broke out on any Instagram or TikTok profile, yours or anyone else's.
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
> Free and open source: https://github.com/RostyslavDzhohola/free-sort-feed-extension
>
> What's new in 1.1
> • Sort by likes, comments, shares, saves, engagement, date and more (you asked for it!)
> • TikTok support
> • "All" view: every scanned video, sorted
> • Exact counts where the page provides them, in any language; Min Views no longer needs a follower count

**Video:** the store takes a YouTube URL. The 1.1 promo MP4 is ready locally; upload it to YouTube once approved and paste the link here.

**Screenshots** (1280×800) and promo tiles (440×280 small, 1400×560 marquee): see `store/assets/`.

## Privacy practices

**Single purpose:**

> Outliers helps creators research short-form video: it lists and sorts the videos on an Instagram or TikTok profile the user is viewing by their public metrics, so the user can find the videos that performed best.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `sidePanel` | Outliers' controls and results live in Chrome's side panel, next to the profile the user is researching. |
| `scripting` | When the user clicks Run, Outliers injects its scanner into the open profile tab to scroll the grid and read each video's public metrics (views, likes, comments, and on TikTok shares, saves, date and length), and to show the sorted results on the page. It runs only on the tab the user is using, only when they use the panel. |
| `storage` | Saves the user's settings (scan limit, filter, sort) and the videos they choose to keep in their Library, locally on the device. |
| Host `*://*.instagram.com/*` | Needed to read the Instagram profile and Reels grid the user is viewing and to show the sorted grid on that page. |
| Host `*://*.cdninstagram.com/*` | Needed to draw video thumbnails into the optional Story card image the user can download. |
| Optional host `*://*.tiktok.com/*` | Requested only when the user clicks "Turn on TikTok" in the panel. Needed to read the TikTok profile grid the user is viewing and show the sorted grid on that page. Not granted by default, so Instagram-only users are never asked. |

**Are you using remote code?** No. All JavaScript ships in the package; nothing is fetched and executed at runtime.

**Data usage.** What user data do you plan to collect from users now or in the future? Chrome counts data an extension handles on the device, even when it never leaves the browser, so declare the page content Outliers reads:

- Personally identifiable information: no
- Health information: no
- Financial and payment information: no
- Authentication information: no
- Personal communications: no
- Location: no
- Web history: no
- User activity: no
- **Website content: yes.** When the user runs a scan, Outliers reads the profile page's public video data (video links, cover images, view, like, comment, share and save counts, post dates, lengths, and the follower count) to list and sort them. It processes this only in the user's browser. Videos the user saves to the Library, and the user's settings, are kept in `chrome.storage.local` on their device. Nothing is sent to the developer or any server.

Certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** keep the current one, and make sure it says the same as the Website content answer above: page data is read and processed locally, saved videos and settings stay on the device, nothing is transmitted. If the listing has none, use the README's Privacy section on GitHub, or the website's privacy page once it exists.

## Notes for submission

- 1.1.0 adds no required permissions, only `optional_host_permissions` for TikTok, so the update installs silently for existing users.
- If a reviewer asks about the page-world script: `page-bridge.js` is injected only into the tab the user is scanning, after they click Run. It reads the counts the page already loaded and returns them to the extension's scanner; it doesn't modify the page or make network requests.
