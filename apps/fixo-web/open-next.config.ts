import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No cache backends: fixo-web has no ISR (no `revalidate`/`dynamic` exports),
// so nothing to persist — no R2/KV/D1. Static assets ship via the ASSETS
// binding; dynamic routes pass through. The Next build itself runs with
// `--webpack` (see package.json cf:* scripts) so next-pwa's webpack-only
// service-worker plugin fires; OpenNext bundles the result with --skipBuild.
export default defineCloudflareConfig({});
