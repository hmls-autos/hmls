import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext reads .next/standalone — keep this.
  output: "standalone",
  experimental: {
    viewTransition: true,
  },
  images: {
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
  },
};

// Makes Cloudflare bindings available under `next dev`. No-op outside dev.
initOpenNextCloudflareForDev();

// PWA note: dropped @ducanh2912/next-pwa (webpack-only SW generation, which
// blocks OpenNext's turbopack build). The app stays installable via its web
// manifest (public/manifest.json + app/manifest.ts); no app code depended on
// the service worker (no offline feature). Re-add a Workers-compatible SW
// later if offline caching becomes a product requirement. See
// docs/cloudflare-migration.md Phase 2.
export default nextConfig;
