// Deploy-time settings for the website. Change them here or override them with env vars at build time:
//   SITE_URL=https://example.com SITE_INDEXABLE=true pnpm build:web
//
// The domain is still undecided, so the default is a reserved placeholder (RFC 2606) that can never resolve.
// It feeds `site` in astro.config.mjs, which builds canonical URLs, Open Graph URLs, the sitemap and robots.txt.

/** Public origin of the site, without a trailing path. */
export const SITE_URL = process.env.SITE_URL ?? "https://outliers.example";

/**
 * Keep false until the owner approves launch. While false, every page ships
 * <meta name="robots" content="noindex, nofollow">.
 */
export const SITE_INDEXABLE = process.env.SITE_INDEXABLE === "true";
