// Renders public/og-image.png (1200×630) from og/template.html with headless Chrome.
//   pnpm --filter @outliers/website og
// Fonts and the icon are inlined as data URIs because Chrome blocks web fonts on file:// pages.
// Set CHROME_PATH if Chrome isn't in the default macOS location.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
const font = (pkg, file, family, style) =>
  `@font-face { font-family: "${family}"; font-style: ${style}; font-weight: 100 900; src: url(${dataUri(require.resolve(`${pkg}/files/${file}`), "font/woff2")}) format("woff2-variations"); }`;

const fonts = [
  font("@fontsource-variable/fraunces", "fraunces-latin-full-normal.woff2", "Fraunces Variable", "normal"),
  font("@fontsource-variable/fraunces", "fraunces-latin-full-italic.woff2", "Fraunces Variable", "italic"),
  font("@fontsource-variable/instrument-sans", "instrument-sans-latin-wght-normal.woff2", "Instrument Sans Variable", "normal"),
].join("\n");

// Top six outliers of the sample profile (see src/data/sample.ts), with the site's cover palette.
const PALETTES = [
  ["#d9a066", "#7d4424"], ["#9fb4a0", "#34503f"], ["#c3b2d6", "#523f73"], ["#e2c48c", "#8f6128"],
  ["#a2b7c8", "#384e63"], ["#d6a49c", "#7f403b"], ["#b9b48c", "#55512f"], ["#c79ab8", "#6a2f59"],
  ["#e0b07a", "#9a4f1c"], ["#8fb3b0", "#2f5552"],
];
const tiles = [
  [8, "75.0×", "1.4M"], [34, "28.3×", "520K"], [18, "17.0×", "312K"],
  [2, "11.6×", "214K"], [26, "7.7×", "141K"], [12, "5.2×", "96.3K"],
].map(([index, ratio, views], i) => {
  const [c1, c2] = PALETTES[(index * 3) % PALETTES.length];
  const style = `--c1:${c1};--c2:${c2};--a:${150 + ((index * 23) % 50)}deg;--x:${25 + ((index * 31) % 50)}%;--y:${20 + ((index * 17) % 40)}%`;
  const scribble = i === 2 ? '<svg class="scribble" viewBox="0 0 100 50" preserveAspectRatio="none"><path d="M16 31 C 9 13, 52 3, 82 9 S 101 37, 74 45 S 17 47, 11 27"/></svg>' : "";
  return `<div class="tile" style="${style}"><span class="rk">${i + 1}</span><span class="rt">${ratio}${scribble}</span><span class="tv">▶ ${views}</span></div>`;
}).join("");

const html = readFileSync(here("./template.html"), "utf8")
  .replace("{{FONTS}}", fonts)
  .replace("{{ICON}}", dataUri(here("../src/assets/icon-128.png"), "image/png"))
  .replace("{{TILES}}", tiles);

const dir = mkdtempSync(join(tmpdir(), "outliers-og-"));
const page = join(dir, "og.html");
writeFileSync(page, html);

const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = here("../public/og-image.png");
execFileSync(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=1200,630",
  "--virtual-time-budget=3000",
  `--screenshot=${out}`,
  `file://${page}`,
], { stdio: "inherit" });
console.log("Wrote", out);
