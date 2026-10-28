import type { APIRoute } from "astro";

// Crawling stays allowed so crawlers can see each page's robots meta. Until launch every page
// carries noindex (see SITE_INDEXABLE in site.config.mjs), which is what keeps the site out of search.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL("/sitemap-index.xml", site).href;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
