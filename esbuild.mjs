import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, watch } from "node:fs";

const isWatch = process.argv.includes("--watch");

// Clean dist/ before each build to remove stale files (e.g. hot-reload.js from watch mode)
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/icons", { recursive: true });

// Copy static assets to dist/
function copyStaticAssets() {
  cpSync("src/sidepanel.html", "dist/sidepanel.html");
  cpSync("icons", "dist/icons", { recursive: true });
  const manifest = JSON.parse(readFileSync("src/manifest.json", "utf-8"));
  writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
}

copyStaticAssets();

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
        copyStaticAssets();
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
  define: {
    __OUTLIERS_WATCH__: isWatch ? "true" : "false",
  },
};

const entryPoints = [
  { in: "src/sidepanel.ts", out: "sidepanel" },
  { in: "src/injected.ts", out: "injected" },
  { in: "src/background.ts", out: "background" },
];

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
  // Watch static assets that esbuild doesn't track
  const staticFiles = ["src/manifest.json", "src/sidepanel.html"];
  for (const file of staticFiles) {
    watch(file, { persistent: false }, () => {
      const time = new Date().toLocaleTimeString();
      console.log(`\n\x1b[33m⚡ [${time}] Static asset changed: ${file}\x1b[0m`);
      copyStaticAssets();
      console.log(`\x1b[32m✔ [${time}] Static assets re-copied\x1b[0m`);
    });
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
