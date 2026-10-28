# Outliers website

The marketing site for the Outliers Chrome extension, direction C ("Field Notes"). It's a static [Astro](https://astro.build) site with small vanilla-TypeScript islands. There's no UI framework, and the only third-party script is [DataFast](https://datafa.st)'s cookieless analytics.

Live at **https://outliers-extension.vercel.app** (Vercel project `outliers-extension`).

The source of truth for design is `DESIGN-SPEC.md` in the design worktree (direction C). Its §0 (Revision 2) and §6.4 (the demo) override older sections. Copy must match how the extension really behaves (§2 guardrails), so check `apps/extension/src` before changing any claim.

## Develop

Run everything from the repo root:

```bash
pnpm install
pnpm dev:web        # http://127.0.0.1:4321/ (localhost only)
pnpm build:web      # static site → apps/website/dist/
pnpm preview:web    # serve the built dist/ locally
```

Checks (also part of the root `pnpm typecheck` / `lint` / `test`):

```bash
pnpm --filter @outliers/website typecheck   # astro check
pnpm --filter @outliers/website lint        # eslint on src/**/*.ts
pnpm --filter @outliers/website test        # builds, then checks dist/, the demo engine and the demo data
```

Astro's CLI telemetry is turned off in every script (`ASTRO_TELEMETRY_DISABLED=1`).

## Site URL, launch switch and flags

The settings live in [`site.config.mjs`](./site.config.mjs):

| Setting | Default | Effect |
| --- | --- | --- |
| `SITE_URL` | `https://outliers-extension.vercel.app` | Canonical URLs, `og:url`/`og:image`, `sitemap-index.xml`, and the `Sitemap:` line in `robots.txt`. |
| `SITE_INDEXABLE` | `true` (launched) | Set `SITE_INDEXABLE=false` for a build that must stay out of search: every page then ships `<meta name="robots" content="noindex, nofollow">`. The 404 page is always noindex. |
| `DATAFAST` | on | The DataFast website id and domain. `DATAFAST=false` builds without the script. |
| `RELEASE_1_1` | `false` | Turns on the Outliers 1.1 copy (sort by any metric, simple sort, TikTok) and replaces the "Coming soon" line. Flip it only once 1.1 is live in the Chrome Web Store. |
| `PROMO_VIDEO` | `null` | A video URL under `public/` (e.g. `/promo/outliers-1.1.mp4`), shown at the top of Features when `RELEASE_1_1` is on. |
| `SHOW_PENDING_DEMO_PROFILES` | `false` | Includes demo profiles whose permission is `"pending"` in a build. Use it only for a local preview. `astro dev` always shows them. |

Change the defaults in that file, or override them per build:

```bash
SITE_INDEXABLE=false DATAFAST=false pnpm build:web
```

`robots.txt` always allows crawling, so crawlers can see a noindex tag. Blocking crawlers would hide it.

### Shipping 1.1

When 1.1 is approved and live in the store: drop the promo video into `public/promo/`, set `RELEASE_1_1 = true` and `PROMO_VIDEO` in `site.config.mjs`, check the 1.1 copy in `components/home/Features.astro` and `data/faq.ts` against the released extension, then redeploy.

## Analytics (DataFast)

In production builds, `layouts/Base.astro` inlines a small script (`#datafast-queue`). It queues goals sent before the tracker loads, and it loads `https://datafa.st/js/script.cookieless.js` only when the page's hostname is `outliers-extension.vercel.app`, so localhost, Vercel preview URLs and per-deployment URLs send nothing. Cookieless mode is also switched on in the DataFast dashboard, so the site sets no cookies and needs no banner.

Custom goals (created in DataFast on their first event):
- `install_click`: any **Add to Chrome** button (`StoreButton.astro`), with `location` = `nav`, `hero` or `close`.
- `demo_run`: **Run** in the demo (`lib/analytics.ts` → `demo-client.ts`), with `profile` and `mode`.

The privacy page (§VI) describes what DataFast records. Keep it in step if the setup changes. The extension itself still collects nothing.

## Deploy (Vercel)

The Vercel project `outliers-extension` builds from this monorepo with **Root Directory** `apps/website`. [`vercel.json`](./vercel.json) sets the install and build commands, the `dist` output, trailing slashes and cache headers. The project has `ENABLE_EXPERIMENTAL_COREPACK=1`, so Vercel uses the repo's pinned pnpm. Deploy from the repo root:

```bash
vercel deploy          # preview
vercel deploy --prod   # https://outliers-extension.vercel.app
```

The project isn't connected to Git yet, so pushes don't deploy on their own.

## Layout

```
site.config.mjs              SITE_URL, launch switch, DataFast, 1.1 flag, pending-profile switch
vercel.json                  Vercel build settings (project root: apps/website)
astro.config.mjs             static output, sitemap, dev server port 4321, pending-profile pruning
integrations/                prune-pending-demo.mjs (drops pending profiles' thumbnails from dist/)
og/                          template + script that renders public/og-image.png
public/                      favicon, og-image.png, font licences, demo/<handle>/thumbs/
src/
  config/site.ts             name, title, store and repo URLs, nav anchors, footer links (one place)
  data/demo/                 demo profiles: profiles.json + <handle>/snapshot.json (+ extension-5x.csv)
  data/faq.ts                home FAQ (verbatim from the prototype), support diagnostics, known limits
  lib/demo-engine.ts         the scan replay as a pure state machine (tested)
  lib/demo-render.ts         Reel tile and result-row HTML, shared by server and island
  lib/analytics.ts           DataFast custom goals
  layouts/                   Base.astro (<head>, masthead, footer), Doc.astro (privacy/support/404)
  components/home/*          home page sections
  components/demo/*          chapter I, the scan replay (Demo.astro + demo-client.ts)
  components/panel/*         the swappable side panel used by the demo (see below)
  components/icons.ts        monochrome footer icons
  pages/                     index, privacy, support, 404, robots.txt
  styles/                    global tokens/base, tiles (Reel grid), document pages
```

Home page order: Hero → I. Demo → II. Features → III. Setup → Privacy → IV. FAQ → closing CTA (with the owner's portfolio, GitHub, X and Instagram) → footer. The nav links are Demo · Features · Setup · FAQ (`sectionLinks` in `config/site.ts`). Features replaced the earlier "Setting the bar" and "Ways to use it" chapters to keep the page short.

Shared extension logic comes from [`@outliers/core`](../../packages/core): `formatCount`, the 5× rule, slider curves, the CSV layout and the empty-state copy. Its tests check it against the extension source.

The islands are plain `<script>` modules next to their markup:
- `BeforeAfter.astro`: the before/after compare (§6.1).
- `demo/demo-client.ts`: the scan replay (§6.4).

Every initial state is rendered on the server, so the page reads correctly without JavaScript and nothing shifts on load.

## The demo: a replay of a real snapshot

A website can't scan Instagram for a visitor. Cross-origin reads are blocked, there's a login wall and Instagram's terms forbid it, and scanning would need a server, which would break "nothing leaves your browser". So chapter I replays snapshots of real Reels tabs, each verified against a real extension CSV export (`extension-5x.csv`). A snapshot and its export may come from different sessions; `comparison.json` records which. `lib/demo-engine.ts` mirrors the v1.0.7 panel (the scan is unchanged in v1.0.8):
- it collects tiles in batches of 12 before checking the scan limit;
- Stop finalizes what's been collected;
- settings changed after a scan apply only after Reset → Run;
- progress and Copy text match the extension word for word. Empty-state text does too, with **one deliberate exception**: v1.0.7's scan-limit hint ("Scanned: first N reels only") names the limit even when a batch overshot it or Stop ended the scan early. That's a known extension bug, so the replay names the number of Reels actually collected, and only when the limit was reached.

Results come from `findOutliers` in `@outliers/core`. Open and Copy link point at the real Reels, and a "Follow @handle on Instagram" link appears after results. The label "Replay of a real snapshot captured {date}, checked against the extension's own export. Live numbers on Instagram will differ." is always shown (`lib/demo-copy.ts`). Third-party creators also get a credit and disclosure linking to their Instagram, which says "shown with permission" only once `permission` is `"granted"`.

### Adding the real snapshots (data drop)

The design thread captures each profile as `snapshot.json`, `thumbs/*.jpg`, `extension-5x.csv` and `comparison.json`. The snapshot's shape is `{ handle, followersText, followers, capturedAt, capturedAtLocal, reelCount, reels: [{ shortcode, url, viewsText, views, thumb }] }`, in grid order (newest first). For each profile:

1. Run `pnpm --filter @outliers/website demo:import <capture-dir>`. It copies `snapshot.json`, `extension-5x.csv` and `comparison.json` to `src/data/demo/<handle>/`, and writes the thumbnails as WebP (q82, about 60% smaller) to `public/demo/<handle>/thumbs/`, rewriting the `thumb` paths.
2. Add the profile to `src/data/demo/profiles.json`:
   ```json
   { "handle": "benaratame", "kind": "real", "permission": "pending", "featured": true },
   { "handle": "heyrostyslav", "kind": "real", "permission": "granted", "owner": true, "hero": true }
   ```
   `featured` is selected first in the demo. `hero` drives the hero before/after. `owner` skips the "Featured with permission" label.
3. Run `pnpm --filter @outliers/website test`. For every real profile it checks the snapshot's shape and that every thumbnail exists. It also compares against the extension's CSV export, which can cover more Reels than the snapshot (it scanned to its own limit):
   - every 5× outlier computed over the snapshot is in the CSV with the same views;
   - every CSV row whose Reel is in the snapshot is computed, in the same order;
   - the remaining CSV rows match `comparison.json`'s `csvOnlyBeyondSnapshot`;
   - the follower count implied by the CSV's multiples gives the same set.

   For @benaratame, the snapshot holds the first 60 Reels at 31,822 followers (bar 159,110). The extension read 32,000 (bar 160,000) and found 8 outliers in 102 Reels. 6 are in the snapshot; the other 2 are beyond it.

The date label uses `capturedAtLocal` (the capture's own calendar date), because `capturedAt` may be UTC and fall on the next day. The replay can't scan past its snapshot, so the scan-limit slider stops at the number of Reels captured: the track beyond it is greyed out and a note reads "Snapshot of the 60 most recent Reels".

When there's at least one real profile, the demo shows only real profiles. `@sample.studio` stays as the fallback dataset.

### Permission gate

`"permission": "pending"` keeps a third-party creator off the public site until they agree to be featured:
- `astro dev` shows the profile with a "Permission pending · dev only" badge.
- Production builds leave the profile out of every page. `integrations/prune-pending-demo.mjs` also deletes its thumbnails from `dist/`.
- A test fails if a pending handle appears anywhere in `dist/`.

To check a pending profile in a production build locally, run `SHOW_PENDING_DEMO_PROFILES=true pnpm build:web && pnpm preview:web`. Don't deploy that build. Once permission is granted, set `"permission": "granted"`; the label "Featured with permission." then appears.

## Swapping the side panel

The extension's side panel is being redesigned. The demo drives the panel only through the hooks in `components/panel/types.ts`, so it never depends on how the panel looks:
- `PANEL_HOOKS`: `data-panel-*` attributes for the threshold, the scan-limit and Min Views sliders, the mode buttons, Run/Stop/Reset, status, progress, the results list, empty state, CSV and Copy.
- `data-zone="1"`–`"5"` wrappers around the annotated areas (Active threshold, Scan limit, Filter mode, Ranked results, Export & copy). Each holds `<Pin n={…} hint />`. The demo toggles `.active` on the hinted zone and shows the hint text from `components/panel/hints.ts`.

`components/panel/DemoPanel.astro` is today's v1.0.7 panel. To switch to the redesign:

1. Add `components/panel/<NewPanel>.astro`. Render every `PANEL_HOOKS` element with the noted element type, the five zones with their pins, and your own `.active` zone highlight.
2. Update `hints.ts` if the copy changes.
3. Repoint `DemoPanel` in `components/panel/index.ts`. The demo section and the page don't change.

If the redesign drops or adds an annotated area, change `PANEL_ZONES` and the hints together.

## Footer links

`socialLinks` in `src/config/site.ts` is the single list of public identity links: email, Instagram, X, TikTok, GitHub, YouTube, LinkedIn and Portfolio. The footer renders each as a monochrome icon from `components/icons.ts`, with an `aria-label` and a `title` tooltip. A link whose `href` is `null` is hidden. TikTok stays `null` until the owner confirms the URL; never guess a handle.

## Fonts and images

- Fraunces (full axes, normal and italic) and Instrument Sans (wght) are self-hosted through `@fontsource-variable/*`. The latin files used above the fold are preloaded: Fraunces normal and italic, and Instrument Sans. The OFL licences are in `public/licenses/`.
- `public/og-image.png` is a placeholder 1200×630 card. To regenerate it after editing `og/template.html`, run `pnpm --filter @outliers/website og`. It needs Google Chrome; set `CHROME_PATH` if Chrome isn't in the default macOS location.
- Icons are copies of `apps/extension/icons/`. Footer brand marks come from simple-icons (CC0); LinkedIn, email and portfolio are drawn for the site.

## Build note

`astro.config.mjs` bundles `cookie` and `zod` into Astro's build-time prerender chunk (`vite.environments.prerender.resolve.noExternal`). Astro 7 imports these transitive dependencies by bare name. Under pnpm's strict layout they can't be resolved from `apps/website`, so without this setting Node searches parent directories. It either fails or picks up an unrelated copy. Nothing from this ships to browsers.
