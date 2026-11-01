import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// One directory per test process: node --test runs files in parallel, and each cleans up its own.
const tempDir = new URL("./.tmp/" + process.pid + "/", import.meta.url);

/** Bundle a src/ TypeScript module to ESM and import it. */
export async function loadModule(entry) {
  await mkdir(tempDir, { recursive: true });
  const name = entry.replace(/[^a-z0-9]+/gi, "_") + ".mjs";
  const outfile = fileURLToPath(new URL(name, tempDir));
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    absWorkingDir: process.cwd(),
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href + "?t=" + Date.now());
}

export const tempDirPath = fileURLToPath(tempDir);
