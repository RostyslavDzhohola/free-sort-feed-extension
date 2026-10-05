// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { SHOW_PENDING_DEMO_PROFILES, SITE_URL } from "./site.config.mjs";
import { prunePendingDemoProfiles } from "./integrations/prune-pending-demo.mjs";

export default defineConfig({
  site: SITE_URL,
  output: "static",
  build: {
    format: "directory",
  },
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
  devToolbar: {
    enabled: false,
  },
  integrations: [
    sitemap({ filter: (page) => !page.includes("/404") }),
    prunePendingDemoProfiles({ keep: SHOW_PENDING_DEMO_PROFILES }),
  ],
  vite: {
    environments: {
      prerender: {
        resolve: {
          // Astro's build-time prerender chunk (dist/.prerender, deleted after the build) imports these
          // transitive Astro deps by bare name. pnpm's strict layout doesn't expose them to apps/website,
          // so bundle them from Astro's own dependency tree instead of letting Node search parent dirs.
          noExternal: ["cookie", "zod"],
        },
      },
    },
  },
});
