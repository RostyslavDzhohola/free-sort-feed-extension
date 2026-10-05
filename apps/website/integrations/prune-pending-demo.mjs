// Production builds must not ship anything from a demo profile whose creator hasn't granted permission.
// Pages already leave pending profiles out (src/data/demo/profiles.ts); this removes their thumbnails,
// which Astro would otherwise copy from public/demo/<handle>/ into dist/.
import { readFileSync, rmSync } from "node:fs";

export function prunePendingDemoProfiles({ keep }) {
  return {
    name: "outliers:prune-pending-demo-profiles",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        if (keep) return;
        const entries = JSON.parse(readFileSync(new URL("../src/data/demo/profiles.json", import.meta.url), "utf8"));
        for (const entry of entries.filter((e) => e.permission !== "granted")) {
          rmSync(new URL(`demo/${entry.handle}/`, dir), { recursive: true, force: true });
          logger.info(`Left out @${entry.handle}: permission pending`);
        }
      },
    },
  };
}
