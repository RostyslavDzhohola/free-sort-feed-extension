# Outliers website

The marketing site for the Outliers Chrome extension: direction C, "Field Notes". It's a static [Astro](https://astro.build) site with small vanilla-TypeScript islands. It has no UI framework, no analytics and no third-party scripts.

The design source of truth is `DESIGN-SPEC.md` in the design worktree (direction C). Copy has to match real extension behaviour (§2 guardrails), so check `apps/extension/src` before changing any claim.

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
pnpm --filter @outliers/website test        # builds, then checks dist/ and the comparison logic
```

Astro's CLI telemetry is turned off in every script (`ASTRO_TELEMETRY_DISABLED=1`).

## Site URL and launch switch

The domain isn't decided yet, so nothing hard-codes one. Both settings live in [`site.config.mjs`](./site.config.mjs):

| Setting | Default | Effect |
| --- | --- | --- |
| `SITE_URL` | `https://outliers.example` (a reserved placeholder) | Canonical URLs, `og:url` / `og:image`, `sitemap-index.xml`, and the `Sitemap:` line in `robots.txt` |
| `SITE_INDEXABLE` | `false` | While false, every page ships `<meta name="robots" content="noindex, nofollow">`. Set it to true only after the owner approves launch. The 404 page is always noindex. |

Change the defaults in that file, or override them per build:

```bash
SITE_URL=https://your-domain.example SITE_INDEXABLE=true pnpm build:web
```

`robots.txt` always allows crawling, so crawlers can see the noindex tag. Blocking crawlers would hide it.

## Layout

```
site.config.mjs              SITE_URL + launch switch
astro.config.mjs             static output, sitemap, dev server port 4321
og/                          template + script that renders public/og-image.png
public/                      favicon, og-image.png, robots via src/pages, font licences
src/
  config/site.ts             name, title, description, store URL, contact + social links
  data/sample.ts             fictional @sample.studio profile and its 36 Reels (labelled "sample data")
  data/faq.ts                home FAQ (verbatim from the prototype), support diagnostics, known limits
  lib/compare.ts             5× vs Min Views maths for the account-size comparison
  layouts/Base.astro         <head> (SEO, fonts, preloads), masthead, footer
  layouts/Doc.astro          editorial layout for /privacy, /support and 404
  components/home/*          home page sections, in page order
  components/panel/*         the swappable side panel illustration (see below)
  pages/                     index, privacy, support, 404, robots.txt
  styles/                    global tokens and base styles, document pages
```

Shared extension logic (`formatCount`, the 5× rule, slider curves, CSV layout) comes from [`@outliers/core`](../../packages/core). Its tests check it against the extension source.

The three interactive pieces are plain `<script>` islands next to their markup. Every value is rendered on the server first, so the page reads correctly without JavaScript and nothing shifts on load.

- `components/home/BeforeAfter.astro`: before/after compare (§6.1)
- `components/home/AccountCompare.astro`: account-size comparison (§6.2)
- `components/home/PanelTour.astro`: annotated panel (§6.3)

## Swapping the panel illustration

The extension's side panel is being redesigned. The tour in chapter III doesn't know what the panel looks like. It only toggles `.active` on elements marked `data-zone="1"`–`"5"` (pins) and `data-note="1"`–`"5"` (notes).

- `components/panel/types.ts` holds the contract: zone ids 1–5 (Active threshold, Scan limit, Filter mode, Ranked results, Export & copy), the `PanelIllustrationData` props and the `PanelNote` shape.
- `components/panel/PanelIllustration.astro` is today's v1.0.7 panel. It renders purely from its `data` prop.
- `components/panel/sample-panel.ts` holds the data for that panel (built from the sample scan) plus the five tour notes.
- `components/panel/index.ts` is the only thing the tour imports.

To switch to the redesigned panel:

1. Add a new component, e.g. `components/panel/PanelIllustrationV2.astro`. Give its root `role="img"` and an `aria-label`. Wrap each annotated area in an element with `data-zone="<1–5>"` and put `<Pin n={…} />` inside it. Style its own `.active` highlight (see `.sp-zone.active` for the current look).
2. Give it data, either by reusing `PanelIllustrationData` or by extending `types.ts`, and update the notes if the copy changes.
3. Repoint the exports in `components/panel/index.ts`. The page and the tour don't change.

If the redesign drops or adds an annotated area, change `PANEL_ZONES` and the notes together.

## Fonts and images

- Fraunces (full axes, normal and italic) and Instrument Sans (wght) are self-hosted through `@fontsource-variable/*`. The latin files used above the fold (Fraunces normal and italic, Instrument Sans) are preloaded. OFL licences are in `public/licenses/`.
- `public/og-image.png` is a placeholder 1200×630 card in the site's style. To regenerate it after editing `og/template.html`, run `pnpm --filter @outliers/website og`. This needs Google Chrome; set `CHROME_PATH` if it isn't in the default macOS location.
- Icons are copies of `apps/extension/icons/`.

## Build note

`astro.config.mjs` bundles `cookie` and `zod` into Astro's build-time prerender chunk (`vite.environments.prerender.resolve.noExternal`). Astro 7 imports these transitive dependencies by bare name. Under pnpm's strict layout they aren't resolvable from `apps/website`, so without this Node searches parent directories. It either fails or picks up an unrelated copy. Nothing from this ships to browsers.
