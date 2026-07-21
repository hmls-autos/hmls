import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No cache backends: hmls-web has zero ISR (no `revalidate`/`dynamic` exports),
// so there is nothing to persist between requests — no R2 incrementalCache, no
// KV/D1 tagCache, no queue. Static assets are served from the ASSETS binding;
// dynamic routes are pure passthrough. See docs/cloudflare-migration.md Phase 1.
export default defineCloudflareConfig({});
