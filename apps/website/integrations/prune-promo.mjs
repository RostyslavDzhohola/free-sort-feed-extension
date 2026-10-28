// The 1.1 promo video ships only with RELEASE_1_1 (site.config.mjs). Pages leave it out otherwise; this removes
// the files too, which Astro would otherwise copy from public/promo/ into dist/ where anyone could fetch them.
import { rmSync } from "node:fs";

export function pruneUnreleasedPromo({ keep }) {
  return {
    name: "outliers:prune-unreleased-promo",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        if (keep) return;
        rmSync(new URL("promo/", dir), { recursive: true, force: true });
        logger.info("Left out public/promo/: RELEASE_1_1 is off");
      },
    },
  };
}
