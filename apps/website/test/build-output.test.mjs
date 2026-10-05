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
  assert.ok(/real scan of @[\w.]+, captured|sample data from a fictional profile/.test(home), "hero compare names its data source");
  assert.ok(/Replay of a real scan captured .+\. Live numbers on Instagram will differ\.|Sample data from a fictional profile, @sample\.studio\./.test(home), "demo honesty label");
  assert.ok(home.includes('href="/privacy/"'), "privacy policy link");
  assert.ok(!/testimonial|trusted by|★/i.test(home), "no social proof without owner approval");
});

test("revision 2: nav, section order, FAQ naming", () => {
  const home = html["/"];
  const nav = home.match(/<nav class="mast-links"[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map((m) => `${m[1]}:${m[2]}`), ["demo:Demo", "setup:Setup", "bar:Setting the bar", "faq:FAQ"]);
  const order = ["top", "demo", "setup", "bar", "uses", "privacy", "faq"].map((id) => home.indexOf(`id="${id}"`));
  assert.ok(order.every((pos) => pos > 0), "every section is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Hero → Demo → Setup → Setting the bar → Uses → Privacy → FAQ");
  assert.ok(!home.includes('id="tour"'), "the annotated-panel chapter is replaced by the demo");
  assert.ok(home.includes('<p class="smallcaps">FAQ</p>'));
  assert.ok(!/>Questions</.test(home));
  for (const page of Object.values(html)) assert.ok(!/href="\/?#(privacy|tour)"/.test(page), "Privacy and The panel are not in the nav");
});

test("revision 2: it reads as completely free, without promising forever", () => {
  const home = html["/"];
  assert.ok(home.includes("100% free · no account · no paywall"));
  assert.ok(home.includes("<dd>Completely free</dd>"));
  assert.ok(home.includes("Free. No sign-up, no trial, no paid plan."));
  for (const page of Object.values(html)) assert.ok(!/free forever|forever free/i.test(page));
});

test("revision 2: demo replays snapshots through the panel hooks", () => {
  const home = html["/"];
  for (const hook of ["data-panel-run", "data-panel-stop", "data-panel-reset", "data-panel-limit", "data-panel-mode", "data-panel-list", "data-panel-csv", "data-panel-copy"]) {
    assert.ok(home.includes(hook), hook);
  }
  for (const zone of [1, 2, 3, 4, 5]) assert.ok(home.includes(`data-zone="${zone}"`) && home.includes(`id="demo-hint-${zone}"`), `hint ${zone}`);
  const json = home.match(/<script type="application\/json" data-demo-data>([\s\S]*?)<\/script>/)[1];
  const { profiles } = JSON.parse(json);
  assert.ok(profiles.length >= 1);
  for (const p of profiles) assert.equal(p.reels.length > 0, true, p.handle);
});

test("every page carries the disclaimer, page links and footer icon links", () => {
  const icons = [
    "mailto:rosty.build@gmail.com",
    "https://www.instagram.com/heyrostyslav/",
    "https://x.com/dzhohola",
    "https://github.com/RostyslavDzhohola",
    "https://www.youtube.com/@RostyslavDzhohola",
    "https://www.linkedin.com/in/rostyslav-dzhohola/",
    "https://rostyslav.dev",
  ];
  for (const [route, page] of Object.entries(html)) {
    assert.ok(page.includes("Not affiliated with, endorsed by, or sponsored by Instagram or Meta."), `${route} disclaimer`);
    assert.ok(page.includes("is made by Rosty."), `${route} credit`);
    for (const href of ["/privacy/", "/support/"]) assert.ok(page.includes(`href="${href}"`), `${route} → ${href}`);
    const footer = page.slice(page.indexOf('<footer class="footer">'));
    for (const href of icons) {
      const tag = footer.match(new RegExp(`<a href="${href.replace(/[.?*+^$()|[\]\\]/g, "\\$&")}"[^>]*>`))?.[0];
      assert.ok(tag, `${route} footer → ${href}`);
      assert.ok(/aria-label="[^"]+"/.test(tag) && /title="[^"]+"/.test(tag), `${href} has a label and tooltip`);
      if (!href.startsWith("mailto:")) assert.ok(tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"'), href);
    }
    assert.ok(!/tiktok\.com/i.test(page), "TikTok stays hidden until its URL is confirmed");
  }
});

test("demo profiles without permission never reach a production build", () => {
  if (process.env.SHOW_PENDING_DEMO_PROFILES === "true") return;
  const entries = JSON.parse(readFileSync(new URL("../src/data/demo/profiles.json", import.meta.url), "utf8"));
  const files = [];
  const walk = (url) => {
    for (const name of readdirSync(url)) {
      const child = new URL(name, url);
      if (statSync(child).isDirectory()) walk(new URL(name + "/", url));
      else files.push(child);
    }
  };
  walk(dist);
  for (const { handle } of entries.filter((e) => e.permission !== "granted")) {
    assert.ok(!files.some((f) => f.pathname.includes(`/demo/${handle}/`)), `no assets for @${handle}`);
    for (const f of files.filter((f) => /\.(html|js|css|xml|txt|json)$/.test(f.pathname))) {
      assert.ok(!readFileSync(f, "utf8").includes(handle), `${f.pathname} mentions @${handle}`);
    }
  }
});
