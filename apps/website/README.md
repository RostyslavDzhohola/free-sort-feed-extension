# Outliers website

The marketing site for the Outliers Chrome extension, direction C ("Field Notes"). It's a static [Astro](https://astro.build) site with small vanilla-TypeScript islands. There's no UI framework, no analytics and no third-party scripts.

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

## Site URL and launch switch

The domain isn't decided yet, so nothing hard-codes it. The settings live in [`site.config.mjs`](./site.config.mjs):

| Setting | Default | Effect |
| --- | --- | --- |
| `SITE_URL` | `https://outliers.example` (reserved placeholder) | Canonical URLs, `og:url`/`og:image`, `sitemap-index.xml`, and the `Sitemap:` line in `robots.txt`. |
| `SITE_INDEXABLE` | `false` | While false, every page ships `<meta name="robots" content="noindex, nofollow">`. Set it to true only after the owner approves launch. The 404 page is always noindex. |
| `SHOW_PENDING_DEMO_PROFILES` | `false` | Includes demo profiles whose permission is `"pending"` in a build. Use it only for a local preview. `astro dev` always shows them. |

Change the defaults in that file, or override them per build:

```bash
SITE_URL=https://your-domain.example SITE_INDEXABLE=true pnpm build:web
```

`robots.txt` always allows crawling, so crawlers can see the noindex tag. Blocking crawlers would hide it.

## Layout

```
site.config.mjs              SITE_URL, launch switch, pending-profile switch
astro.config.mjs             static output, sitemap, dev server port 4321, pending-profile pruning
integrations/                prune-pending-demo.mjs (drops pending profiles' thumbnails from dist/)
og/                          template + script that renders public/og-image.png
public/                      favicon, og-image.png, font licences, demo/<handle>/thumbs/
src/
  config/site.ts             name, title, store URL, nav anchors, footer links (one place)
  data/demo/                 demo profiles: profiles.json + <handle>/snapshot.json (+ extension-5x.csv)
  data/faq.ts                home FAQ (verbatim from the prototype), support diagnostics, known limits
  lib/demo-engine.ts         the scan replay as a pure state machine (tested)
  lib/demo-render.ts         Reel tile and result-row HTML, shared by server and island
  lib/compare.ts             5× vs Min Views maths for the account-size comparison
  layouts/                   Base.astro (<head>, masthead, footer), Doc.astro (privacy/support/404)
  components/home/*          home page sections
  components/demo/*          chapter I, the scan replay (Demo.astro + demo-client.ts)
  components/panel/*         the swappable side panel used by the demo (see below)
  components/icons.ts        monochrome footer icons
  pages/                     index, privacy, support, 404, robots.txt
  styles/                    global tokens/base, tiles (Reel grid), document pages
```

Home page order (§0.6): Hero → I. Demo → II. Setup → III. Setting the bar → IV. Ways to use it → Privacy → V. FAQ → closing CTA → footer. The nav links are Demo · Setup · Setting the bar · FAQ (`sectionLinks` in `config/site.ts`).

Shared extension logic comes from [`@outliers/core`](../../packages/core): `formatCount`, the 5× rule, slider curves, the CSV layout and the empty-state copy. Its tests check it against the extension source.

The islands are plain `<script>` modules next to their markup:
- `BeforeAfter.astro`: the before/after compare (§6.1).
- `AccountCompare.astro`: the account-size comparison (§6.2).
- `demo/demo-client.ts`: the scan replay (§6.4).

Every initial state is rendered on the server, so the page reads correctly without JavaScript and nothing shifts on load.

## The demo: a replay of a real scan

A website can't scan Instagram for a visitor. Cross-origin reads are blocked, there's a login wall and Instagram's terms forbid it, and scanning would need a server, which would break "nothing leaves your browser". So chapter I replays snapshots captured once through the extension. `lib/demo-engine.ts` mirrors the v1.0.7 panel:
- it collects tiles in batches of 12 before checking the scan limit;
- Stop finalizes what's been collected;
- settings changed after a scan apply only after Reset → Run;
- progress, empty-state and Copy text match the extension word for word.

Results come from `findOutliers` in `@outliers/core`. Open and Copy link point at the real Reels, and a "Follow @handle on Instagram" link appears after results. The label "Replay of a real scan captured {date}. Live numbers on Instagram will differ." is always shown.

### Adding the real snapshots (data drop)

The design thread captures each profile as `snapshot.json`, `thumbs/*.jpg` and `extension-5x.csv` (`{ handle, followersText, followers, capturedAt, reelCount, reels: [{ shortcode, url, viewsText, views, thumb }] }`, newest first). For each profile:

1. Copy `snapshot.json` and `extension-5x.csv` to `src/data/demo/<handle>/`.
2. Copy the thumbnails to `public/demo/<handle>/thumbs/`. `thumb` in the JSON is relative to `public/demo/<handle>/`.
3. Add the profile to `src/data/demo/profiles.json`:
   ```json
   { "handle": "benaratame", "kind": "real", "permission": "pending", "featured": true },
   { "handle": "heyrostyslav", "kind": "real", "permission": "granted", "owner": true, "hero": true }
   ```
   `featured` is selected first in the demo. `hero` drives the hero before/after. `owner` skips the "Featured with permission" label.
4. Run `pnpm --filter @outliers/website test`. For every real profile it checks the snapshot's shape, checks that every thumbnail exists, and checks that the 5× set computed by `@outliers/core` equals `extension-5x.csv` (same Reels, order, views and multiples).

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
