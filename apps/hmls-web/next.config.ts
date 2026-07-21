import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext reads .next/standalone — keep this.
  output: "standalone",
  transpilePackages: ["@hmls/shared"],
  images: {
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
  },
};

// Makes Cloudflare bindings (getCloudflareContext) available under `next dev`.
// No-op outside dev.
initOpenNextCloudflareForDev();

export default nextConfig;
