// Deploy-time settings for the website. Change them here or override them with env vars at build time:
//   SITE_URL=https://example.com SITE_INDEXABLE=false pnpm build:web
//
// SITE_URL feeds `site` in astro.config.mjs, which builds canonical URLs, Open Graph URLs, the sitemap and robots.txt.

/** Public origin of the site, without a trailing path. Production runs on Vercel's default domain. */
export const SITE_URL = process.env.SITE_URL ?? "https://outliers-extension.vercel.app";

/**
 * The owner approved launch, so pages are indexable. Set SITE_INDEXABLE=false for a build that must
 * stay out of search (every page then ships <meta name="robots" content="noindex, nofollow">).
 */
export const SITE_INDEXABLE = process.env.SITE_INDEXABLE !== "false";

/**
 * Demo profiles whose creator hasn't granted permission (permission: "pending" in
 * src/data/demo/profiles.json) always show in `astro dev`. Set this to true only for a local
 * preview build; production builds must leave it false.
 */
export const SHOW_PENDING_DEMO_PROFILES = process.env.SHOW_PENDING_DEMO_PROFILES === "true";

/**
 * DataFast analytics, cookieless script. Base.astro loads the tracker only when the page's hostname is
 * `domain`, so preview deployments and local builds send nothing. Set DATAFAST=false to build without it.
 */
export const DATAFAST = process.env.DATAFAST !== "false" && {
  websiteId: "dfid_RiEbjoAfKP438O6TBOWr0",
  domain: "outliers-extension.vercel.app",
};

/**
 * Outliers 1.1 (sort by likes, comments and every metric, simple sort, TikTok). Keep false until the
 * owner approves 1.1 and it's live in the Chrome Web Store: the site may only promise what the store
 * version does. While false, the features section shows a "Coming soon" line instead.
 */
export const RELEASE_1_1 = process.env.RELEASE_1_1 === "true";

/** Promo video for the 1.1 launch (a URL under public/, e.g. "/promo/outliers-1.1.mp4"). Shown only with RELEASE_1_1. */
export const PROMO_VIDEO = process.env.PROMO_VIDEO ?? null;
