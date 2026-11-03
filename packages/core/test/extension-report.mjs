// The side panel's wording helpers live inside the release's sidepanel.ts and read its globals (the
// current platform and profile), so lift their bodies out and evaluate them with those globals as
// settable variables and the release's own shared modules as their imports.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { loadTs } from "./load-ts.mjs";
import { extractStoreRelease } from "./store-release.mjs";

const FUNCTION_NAMES = ["getThresholdLabel", "formatScanLimitValue", "formatOutlierLine", "describeView", "buildOutliersPlainText"];

export async function loadExtensionReport() {
  const release = extractStoreRelease();
  const videos = await loadTs(pathToFileURL(join(release, "shared/videos.ts")).href);
  const platform = await loadTs(pathToFileURL(join(release, "shared/platform.ts")).href);
  const src = readFileSync(join(release, "sidepanel.ts"), "utf8");
  const functions = FUNCTION_NAMES.map((name) => {
    const match = src.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, "m"));
    if (!match) {
      throw new Error(`sidepanel.ts no longer defines ${name}(). Update packages/core/src/panel.ts and this helper together.`);
    }
    return match[0];
  });
  const { code } = transformSync(functions.join("\n"), { loader: "ts" });
  const deps = { ...videos, ...platform };
  const names = Object.keys(deps);
  const body = `let currentPlatform = null; let lastKnownProfileRef = null;
${code}
return { ${FUNCTION_NAMES.join(", ")}, setContext(platform, ref) { currentPlatform = platform; lastKnownProfileRef = ref; } };`;
  return new Function(...names, body)(...names.map((n) => deps[n]));
}
