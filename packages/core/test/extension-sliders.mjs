// The extension's slider helpers live inside its sidepanel.ts and aren't exported, so lift their
// constants and function bodies out of the store release's source and evaluate them in isolation.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { extractStoreRelease } from "./store-release.mjs";

const FUNCTION_NAMES = [
  "clamp",
  "normalizeScanLimit",
  "roundScanLimitValue",
  "interpolateGeometric",
  "inverseGeometric",
  "scanLimitToSliderPosition",
  "sliderPositionToScanLimit",
  "roundMinViewsValue",
  "ratioToLogValue",
  "logValueToRatio",
  "minViewsToSliderPosition",
  "sliderPositionToMinViews",
];

export function loadExtensionSliders() {
  const src = readFileSync(join(extractStoreRelease(), "sidepanel.ts"), "utf8");
  const constants = src.match(/^const (?:SCAN_|MIN_VIEWS_)\w+ = [\s\S]*?;$/gm) ?? [];
  const functions = FUNCTION_NAMES.map((name) => {
    const match = src.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, "m"));
    if (!match) {
      throw new Error(`sidepanel.ts no longer defines ${name}(). Update packages/core/src/sliders.ts and this helper together.`);
    }
    return match[0];
  });
  const { code } = transformSync([...constants, ...functions].join("\n"), { loader: "ts" });
  return new Function(`${code}\nreturn { ${FUNCTION_NAMES.join(", ")} };`)();
}
