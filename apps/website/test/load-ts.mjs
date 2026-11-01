// Bundle a TypeScript entry with esbuild and import it, without writing temp files.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export async function loadTs(relativeUrl) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativeUrl, import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}
