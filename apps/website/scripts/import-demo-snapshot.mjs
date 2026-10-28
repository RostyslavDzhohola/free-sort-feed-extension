// Imports one captured demo profile (DESIGN-SPEC §6.4) into the site:
//   pnpm --filter @outliers/website demo:import <capture-dir>
// <capture-dir> holds snapshot.json, thumbs/<shortcode>.jpg, extension-5x.csv and (optionally) comparison.json.
//
// - snapshot.json, extension-5x.csv, comparison.json → src/data/demo/<handle>/
// - thumbs → public/demo/<handle>/thumbs/<shortcode>.webp (WebP q82; thumb paths in the JSON are rewritten)
// It doesn't touch profiles.json: add the profile there yourself, with the right permission.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = process.argv[2] ? resolve(process.argv[2]) : null;
if (!source || !existsSync(join(source, "snapshot.json"))) {
  console.error("Usage: pnpm --filter @outliers/website demo:import <dir containing snapshot.json>");
  process.exit(1);
}

const site = fileURLToPath(new URL("..", import.meta.url));
const snapshot = JSON.parse(readFileSync(join(source, "snapshot.json"), "utf8"));
const { handle } = snapshot;
if (!/^[a-z0-9._]+$/i.test(handle ?? "")) throw new Error(`Unexpected handle: ${handle}`);
if (!existsSync(join(source, "extension-5x.csv"))) throw new Error("extension-5x.csv is required as ground truth");

const dataDir = join(site, "src/data/demo", handle);
const thumbDir = join(site, "public/demo", handle, "thumbs");
rmSync(thumbDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(thumbDir, { recursive: true });

let before = 0;
let after = 0;
for (const reel of snapshot.reels) {
  if (!reel.thumb) throw new Error(`${reel.shortcode} has no thumbnail`);
  const input = join(source, reel.thumb);
  const output = `thumbs/${reel.shortcode}.webp`;
  await sharp(input).webp({ quality: 82, effort: 6 }).toFile(join(site, "public/demo", handle, output));
  before += statSync(input).size;
  after += statSync(join(site, "public/demo", handle, output)).size;
  reel.thumb = output;
}

writeFileSync(join(dataDir, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
copyFileSync(join(source, "extension-5x.csv"), join(dataDir, "extension-5x.csv"));
if (existsSync(join(source, "comparison.json"))) copyFileSync(join(source, "comparison.json"), join(dataDir, "comparison.json"));

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`@${handle}: ${snapshot.reels.length} Reels, thumbnails ${kb(before)} → ${kb(after)} (WebP)`);
console.log(`Next: list "${handle}" in src/data/demo/profiles.json with permission "pending" or "granted".`);
