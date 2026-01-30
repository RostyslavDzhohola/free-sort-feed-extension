import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";

const isWatch = process.argv.includes("--watch");

// Clean dist/ before each build to remove stale files (e.g. hot-reload.js from watch mode)
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/icons", { recursive: true });

// Copy static assets to dist/
cpSync("src/popup.html", "dist/popup.html");
cpSync("icons", "dist/icons", { recursive: true });

// In watch mode, inject the background service worker for hot reload
const manifest = JSON.parse(readFileSync("src/manifest.json", "utf-8"));
if (isWatch) {
  manifest.background = { service_worker: "hot-reload.js" };
}
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));

/** Plugin that logs rebuild events with timestamps */
const rebuildLoggerPlugin = {
  name: "rebuild-logger",
  setup(build) {
    let isFirstBuild = true;
    build.onStart(() => {
      if (!isFirstBuild) {
        const time = new Date().toLocaleTimeString();
        console.log(`\n\x1b[33m⚡ [${time}] Rebuilding...\x1b[0m`);
      }
    });
    build.onEnd((result) => {
      if (isFirstBuild) {
        isFirstBuild = false;
        return;
      }
      const time = new Date().toLocaleTimeString();
      if (result.errors.length > 0) {
        console.log(`\x1b[31m✖ [${time}] Build failed with ${result.errors.length} error(s)\x1b[0m`);
      } else {
        // Re-copy static assets on rebuild
        cpSync("src/popup.html", "dist/popup.html");
        const warnings = result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : "";
        console.log(`\x1b[32m✔ [${time}] Rebuild succeeded${warnings}\x1b[0m`);
      }
    });
  },
};

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: "chrome120",
  format: "iife",
};

const entryPoints = [
  { in: "src/popup.ts", out: "popup" },
  { in: "src/injected.ts", out: "injected" },
];

// Include hot-reload service worker in watch mode
if (isWatch) {
  entryPoints.push({ in: "src/hot-reload.ts", out: "hot-reload" });
}

if (isWatch) {
  for (const entry of entryPoints) {
    const ctx = await esbuild.context({
      ...commonOptions,
      entryPoints: [entry.in],
      outfile: `dist/${entry.out}.js`,
      plugins: [rebuildLoggerPlugin],
    });
    await ctx.watch();
  }
  console.log("Watching for changes (hot reload enabled)...");
} else {
  for (const entry of entryPoints) {
    await esbuild.build({
      ...commonOptions,
      entryPoints: [entry.in],
      outfile: `dist/${entry.out}.js`,
    });
  }
  console.log("Build complete.");
}
