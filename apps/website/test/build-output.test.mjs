// Checks the static build in dist/ (the `test` script builds first) against DESIGN-SPEC §2, §8 and §9.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), "utf8");
const pages = {
  "/": "index.html",
  "/privacy/": "privacy/index.html",
  "/support/": "support/index.html",
  "/404": "404.html",
};
const html = Object.fromEntries(Object.entries(pages).map(([route, file]) => [route, read(file)]));
const SITE_URL = process.env.SITE_URL ?? "https://outliers.example";
const STORE_URL = "https://chromewebstore.google.com/detail/outliers/heogkfpbeagpoodininnfhdgjmpdalgj";

test("every route and SEO file is emitted", () => {
  for (const file of [...Object.values(pages), "robots.txt", "sitemap-index.xml", "og-image.png", "favicon.png"]) {
    assert.ok(existsSync(new URL(file, dist)), `missing dist/${file}`);
  }
  assert.match(read("robots.txt"), new RegExp(`Sitemap: ${SITE_URL}/sitemap-index.xml`));
  const sitemap = read("sitemap-0.xml");
  for (const route of ["/", "/privacy/", "/support/"]) assert.ok(sitemap.includes(`<loc>${SITE_URL}${route}</loc>`), route);
  assert.ok(!sitemap.includes("404"));
});

test("pages stay noindex until launch and canonicals come from the site URL", () => {
  for (const [route, page] of Object.entries(html)) {
    const indexable = process.env.SITE_INDEXABLE === "true" && route !== "/404";
    const robots = indexable ? "index, follow" : "noindex, nofollow";
    assert.ok(page.includes(`<meta name="robots" content="${robots}">`), `${route} must be ${robots}`);
    if (route === "/404") {
      assert.ok(!page.includes('rel="canonical"'), "404 has no canonical");
    } else {
      assert.ok(page.includes(`<link rel="canonical" href="${SITE_URL}${route}">`), `${route} canonical`);
      assert.ok(page.includes(`<meta property="og:image" content="${SITE_URL}/og-image.png">`), `${route} og:image`);
    }
  }
});

test("each page has exactly one h1 and a skip link to main", () => {
  for (const [route, page] of Object.entries(html)) {
    assert.equal(page.match(/<h1[\s>]/g)?.length, 1, `${route} h1 count`);
    assert.ok(page.includes('href="#main"') && page.includes('id="main"'), `${route} skip link`);
  }
});

test("no third-party scripts, and JS stays under the 60 KB budget", () => {
  for (const [route, page] of Object.entries(html)) {
    for (const [, src] of page.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
      assert.ok(src.startsWith("/_astro/"), `${route} loads a non-local script: ${src}`);
    }
  }
  const assets = new URL("_astro/", dist);
  const external = readdirSync(assets).filter((f) => f.endsWith(".js")).reduce((sum, f) => sum + statSync(new URL(f, assets)).size, 0);
  const inline = [...html["/"].matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].reduce((sum, m) => sum + m[1].length, 0);
  assert.ok(external + inline < 60_000, `JS is ${external + inline} bytes`);
});

test("store links open in a new tab without referrer", () => {
  const links = [...html["/"].matchAll(/<a[^>]+href="([^"]+)"[^>]*>/g)].filter(([, href]) => href === STORE_URL);
  assert.equal(links.length, 3, "masthead, hero and closing CTA");
  for (const [tag] of links) assert.ok(tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"'), tag);
});

test("home page copy follows the spec", () => {
  const home = html["/"];
  assert.ok(!/Prototype C|All prototypes/.test(home), "prototype-only bar must not ship");
  assert.ok(home.includes("Some Reels travel far past a creator's own audience. Outliers helps you spot them."), "revised hero lede");
  assert.ok(home.includes('<span class="mark">at least 5× more views than followers</span>'), "marked phrase");
  assert.equal(home.match(/<details>/g)?.length, 7, "seven FAQ items");
  assert.ok(home.includes("I set a small scan limit, but it scanned more."), "scan-limit FAQ");
  assert.ok(home.includes("6 of 36 reels • 92,000 views"), "after-layer summary");
  assert.ok(home.includes("sample data from a fictional profile"), "demo labelled as sample data");
  assert.ok(home.includes('href="/privacy/"'), "privacy policy link");
  assert.ok(!/testimonial|trusted by|★/i.test(home), "no social proof without owner approval");
});

test("every page carries the Instagram/Meta disclaimer and footer links", () => {
  for (const [route, page] of Object.entries(html)) {
    assert.ok(page.includes("Not affiliated with, endorsed by, or sponsored by Instagram or Meta."), `${route} disclaimer`);
    for (const href of ["mailto:rosty.build@gmail.com", "/privacy/", "/support/"]) assert.ok(page.includes(`href="${href}"`), `${route} → ${href}`);
  }
});
