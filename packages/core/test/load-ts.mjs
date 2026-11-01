// Bundle a TypeScript entry with esbuild and import it, without writing temp files.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export async function loadTs(relativeUrl) {
  const entry = fileURLToPath(new URL(relativeUrl, import.meta.url));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}
