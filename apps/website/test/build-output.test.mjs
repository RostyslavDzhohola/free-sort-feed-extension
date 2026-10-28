// Checks the static build in dist/ (the `test` script builds first) against DESIGN-SPEC §2, §8 and §9.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { DATAFAST, RELEASE_1_1, SITE_INDEXABLE, SITE_URL } from "../site.config.mjs";

const dist = new URL("../dist/", import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), "utf8");
const pages = {
  "/": "index.html",
  "/privacy/": "privacy/index.html",
  "/support/": "support/index.html",
  "/404": "404.html",
};
const html = Object.fromEntries(Object.entries(pages).map(([route, file]) => [route, read(file)]));
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

test("pages follow the launch switch and canonicals come from the site URL", () => {
  for (const [route, page] of Object.entries(html)) {
    const indexable = SITE_INDEXABLE && route !== "/404";
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

test("the only third-party script is DataFast's cookieless tracker, and JS stays under the 60 KB budget", () => {
  for (const [route, page] of Object.entries(html)) {
    const external = [];
    for (const [tag, src] of page.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)) {
      if (!src.startsWith("/_astro/")) external.push(tag);
    }
    if (!DATAFAST) {
      assert.deepEqual(external, [], `${route} loads no third-party script`);
      continue;
    }
    assert.equal(external.length, 1, `${route} loads one third-party script`);
    const [tag] = external;
    assert.ok(tag.includes('src="https://datafa.st/js/script.cookieless.js"'), `${route} uses the cookieless script: ${tag}`);
    assert.ok(tag.includes(`data-website-id="${DATAFAST.websiteId}"`) && tag.includes(`data-domain="${DATAFAST.domain}"`), tag);
    assert.ok(/\sdefer[\s>=]/.test(tag), "the tracker is deferred");
    assert.ok(page.indexOf('id="datafast-queue"') < page.indexOf(tag), `${route} queues goals before the tracker loads`);
  }
  const assets = new URL("_astro/", dist);
  const external = readdirSync(assets).filter((f) => f.endsWith(".js")).reduce((sum, f) => sum + statSync(new URL(f, assets)).size, 0);
  const inline = [...html["/"].matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].reduce((sum, m) => sum + m[1].length, 0);
  assert.ok(external + inline < 60_000, `JS is ${external + inline} bytes`);
});

test("store links open in a new tab without referrer and count as install_click goals", () => {
  const links = [...html["/"].matchAll(/<a[^>]+href="([^"]+)"[^>]*>/g)].filter(([, href]) => href === STORE_URL);
  assert.equal(links.length, 3, "masthead, hero and closing CTA");
  for (const [tag] of links) assert.ok(tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"'), tag);
  for (const [tag] of links) assert.ok(tag.includes('data-fast-goal="install_click"'), tag);
  assert.deepEqual(
    links.map(([tag]) => tag.match(/data-fast-goal-location="([^"]+)"/)?.[1]),
    ["nav", "hero", "close"],
  );
});

test("home page copy follows the spec", () => {
  const home = html["/"];
  assert.ok(!/Prototype C|All prototypes/.test(home), "prototype-only bar must not ship");
  assert.ok(home.includes("Some Reels travel far past a creator's own audience. Outliers helps you spot them."), "revised hero lede");
  assert.ok(home.includes('<span class="mark">at least 5× more views than followers</span>'), "marked phrase");
  assert.equal(home.match(/<details>/g)?.length, 8, "eight FAQ items");
  assert.ok(home.includes("Is it really free? Which browsers?"), "the FAQ opens with free");
  assert.ok(home.includes("I set a small scan limit, but it scanned more."), "scan-limit FAQ");
  assert.ok(/real snapshot of @[\w.]+, captured|sample data from a fictional profile/.test(home), "hero compare names its data source");
  assert.ok(
    /Replay of a real snapshot captured .+, checked against the extension&#39;s own export\. Live numbers on Instagram will differ\.|Sample data from a fictional profile, @sample\.studio\./.test(home),
    "demo honesty label",
  );
  assert.ok(!/real scan/i.test(home), "snapshots aren't called scans: the verifying export can come from another session");
  assert.ok(home.includes('href="/privacy/"'), "privacy policy link");
  assert.ok(!/testimonial|trusted by|★/i.test(home), "no social proof without owner approval");
});

test("launch layout: nav, section order, FAQ naming", () => {
  const home = html["/"];
  const nav = home.match(/<nav class="mast-links"[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map((m) => `${m[1]}:${m[2]}`), ["demo:Demo", "features:Features", "setup:Setup", "faq:FAQ"]);
  const order = ["top", "demo", "features", "setup", "privacy", "faq"].map((id) => home.indexOf(`id="${id}"`));
  assert.ok(order.every((pos) => pos > 0), "every section is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Hero → Demo → Features → Setup → Privacy → FAQ");
  assert.ok(!home.includes('id="bar"') && !home.includes('id="uses"'), "Setting the bar and Ways to use it are folded into Features");
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

test("the owner's real profile ships in the production demo, with no third-party credit", () => {
  if (process.env.SHOW_PENDING_DEMO_PROFILES === "true") return;
  const home = html["/"];
  const { profiles } = JSON.parse(home.match(/<script type="application\/json" data-demo-data>([\s\S]*?)<\/script>/)[1]);
  const owner = profiles.find((p) => p.handle === "heyrostyslav");
  assert.ok(owner, "@heyrostyslav is in the demo");
  assert.equal(owner.kind, "real");
  assert.equal(owner.owner, true);
  assert.equal(profiles[0].handle, "heyrostyslav", "with pending creators left out, the owner's profile opens the demo");
  assert.ok(/<p class="demo-credit" data-demo-credit hidden[\s>]/.test(home), "no creator credit for the owner's own profile");
  assert.ok(home.includes("Replay of a real snapshot captured"), "real-snapshot honesty label");
});

test("the creator credit keeps spaces between its lead, link and detail", () => {
  const credit = html["/"].match(/<p class="demo-credit"[\s\S]*?<\/p>/)[0];
  assert.match(credit, /<\/span> <a data-demo-credit-link/, "space after the lead");
  assert.match(credit, /<\/a>\. <span data-demo-credit-detail/, "space after the link");
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
    "https://www.tiktok.com/@rostyslavdzhohola",
  ];
  for (const [route, page] of Object.entries(html)) {
    assert.ok(page.includes("Not affiliated with, endorsed by, or sponsored by Instagram or Meta."), `${route} disclaimer`);
    assert.ok(page.includes('is made by <a href="https://rostyslav.dev" target="_blank" rel="noopener noreferrer">Rosty</a>.'), `${route} credit`);
    assert.ok(page.includes(`href="https://github.com/RostyslavDzhohola/free-sort-feed-extension"`), `${route} source code link`);
    for (const href of ["/privacy/", "/support/"]) assert.ok(page.includes(`href="${href}"`), `${route} → ${href}`);
    const footer = page.slice(page.indexOf('<footer class="footer">'));
    const footerIcons = footer.slice(footer.indexOf('<ul class="footer-icons"'));
    for (const href of icons) {
      const tag = footerIcons.match(new RegExp(`<a href="${href.replace(/[.?*+^$()|[\]\\]/g, "\\$&")}"[^>]*>`))?.[0];
      assert.ok(tag, `${route} footer → ${href}`);
      assert.ok(/aria-label="[^"]+"/.test(tag) && /title="[^"]+"/.test(tag), `${href} has a label and tooltip`);
      if (!href.startsWith("mailto:")) assert.ok(tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"'), href);
    }
    assert.equal(footer.match(/tiktok\.com/gi)?.length, 1, `${route} links TikTok exactly once`);
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

test("1.1 copy stays off until 1.1 is in the store, behind one flag", () => {
  const home = html["/"];
  if (RELEASE_1_1) {
    assert.ok(home.includes("Sort by any metric") && home.includes("TikTok, too"), "1.1 features show");
    assert.ok(!home.includes('class="features-soon"'));
    return;
  }
  assert.ok(/<span class="smallcaps">Coming soon<\/span> TikTok support, and sorting by likes and comments\./.test(home), "labelled coming-soon line");
  for (const page of Object.values(html)) {
    assert.ok(!/new in 1\.1|Sort by any metric|Simple sort|Instagram and TikTok research/.test(page), "no 1.1 promises");
  }
  assert.ok(home.includes("Sorting by likes and comments is coming soon"), "FAQ says not yet");
});

test("the site is honest about its own analytics, and keeps the extension's claims separate", () => {
  const privacy = html["/privacy/"];
  assert.ok(!/This site has no analytics/.test(privacy), "the old no-analytics claim is gone");
  if (DATAFAST) {
    assert.ok(privacy.includes("DataFast") && privacy.includes("cookieless mode"), "privacy names DataFast and cookieless mode");
    assert.ok(privacy.includes("The extension sends nothing to DataFast or anywhere else."));
  }
  assert.ok(privacy.includes("No analytics, tracking, ads or cookies."), "the extension's own claims stay");
  assert.ok(privacy.includes("version 1.0.8"), "policy covers the store version");
  assert.ok(html["/"].includes("it counts visits and button clicks with cookieless analytics"), "privacy band separates site and extension");
});
