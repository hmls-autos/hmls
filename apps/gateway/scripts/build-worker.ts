// Bundle the Workers entrypoint into a single ESM file.
//
// wrangler's built-in esbuild uses Node resolution: it cannot see deno.json
// import maps, JSR deps (@logtape/logtape), or the Deno workspace packages
// (@hmls/agent has no package.json) — blockers C1/C2 in
// docs/cloudflare-migration.md. So we bundle here with the official Deno
// esbuild plugin and hand wrangler the finished file (`no_bundle` in
// wrangler.jsonc).
//
//   deno task --cwd apps/gateway build:worker
import { denoPlugin } from "@deno/esbuild-plugin";
import * as esbuild from "esbuild";

const here = new URL(".", import.meta.url).pathname;

const result = await esbuild.build({
  entryPoints: [`${here}../src/worker.ts`],
  outfile: `${here}../dist/worker.js`,
  bundle: true,
  format: "esm",
  platform: "browser",
  // Prefer workerd-specific package builds where they exist.
  conditions: ["workerd", "worker"],
  // nodejs_compat provides node:* at runtime; cloudflare:* is runtime-only.
  external: ["node:*", "cloudflare:*"],
  target: "es2022",
  sourcemap: true,
  metafile: true,
  logLevel: "info",
  plugins: [denoPlugin()],
});

const outBytes = (await Deno.stat(`${here}../dist/worker.js`)).size;
console.log(`worker.js: ${(outBytes / 1024 / 1024).toFixed(2)} MB (pre-gzip)`);
await Deno.writeTextFile(`${here}../dist/metafile.json`, JSON.stringify(result.metafile));
await esbuild.stop();
