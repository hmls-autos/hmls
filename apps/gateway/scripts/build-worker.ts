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

// Bare (unprefixed) Node built-in ids appear in CJS deps (queue requires
// "events", crypto-js probes "crypto"). Left external, esbuild turns those
// requires into dynamic `__require("events")` bombs that throw at isolate
// boot. Shim them as bundled modules that re-export the workerd-supported
// node:* equivalent — ESM imports of externals survive as plain top-level
// imports, which workerd resolves fine. Builtins workerd does NOT support
// (child_process, worker_threads, …) are deliberately absent: an import of
// one should fail the build here, not the isolate at boot. `fs` is the one
// exception (empty-stub special case in onLoad below).
const WORKERD_NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "crypto",
  "diagnostics_channel",
  "dns",
  "events",
  "net",
  "path",
  "querystring",
  "stream",
  "stream/web",
  "string_decoder",
  "timers",
  "tls",
  "url",
  "util",
  "zlib",
]);
const nodeBuiltinShims: esbuild.Plugin = {
  name: "node-builtin-shims",
  setup(build) {
    build.onResolve({ filter: /^[a-z_/]+$/ }, (args) => {
      if (args.path !== "fs" && !WORKERD_NODE_BUILTINS.has(args.path)) return null;
      return { path: args.path, namespace: "node-shim" };
    });
    build.onLoad({ filter: /.*/, namespace: "node-shim" }, (args) => {
      // workerd has no node:fs. The only fs importer left is
      // @react-pdf/renderer's Node build, which touches it solely in
      // renderToFile (never called server-side) — an empty default suffices.
      if (args.path === "fs") {
        return { contents: `export default {};\n`, loader: "js" };
      }
      return {
        contents: `import * as m from "node:${args.path}";\n` +
          `export default m.default ?? m;\n` +
          `export * from "node:${args.path}";\n`,
        loader: "js",
      };
    });
  },
};

// The Deno loader resolves npm packages by their Node "main" entry, whose
// bare `fs`/`path` imports die on workerd. @react-pdf/pdfkit, png-js, and
// image ship fs-free browser builds (package.json "browser" field, which the
// loader doesn't honor) — swap those entry files by hand. The renderer
// itself deliberately KEEPS its Node build: its browser build stubs
// renderToBuffer with a throw, while the Node build touches fs only in
// renderToFile (never called here) — covered by the empty fs shim above.
const reactPdfBrowserBuilds: esbuild.Plugin = {
  name: "react-pdf-browser-builds",
  setup(build) {
    build.onLoad(
      { filter: /@react-pdf[/+](pdfkit|png-js|image).*\/lib\/(pdfkit|png-js|index)\.js$/ },
      async (args) => {
        const browserPath = args.path.replace(/\.js$/, ".browser.js");
        try {
          const contents = await Deno.readTextFile(browserPath);
          const resolveDir = browserPath.slice(0, browserPath.lastIndexOf("/"));
          return { contents, loader: "js", resolveDir };
        } catch {
          return null; // no browser sibling — let the default loader handle it
        }
      },
    );
  },
};

// yoga-layout (react-pdf's flexbox engine) ships ONLY as emscripten wasm,
// instantiated from base64 bytes at runtime — workerd forbids that ("Wasm
// code generation disallowed"). Workers DO allow synchronous instantiation
// of a PRE-COMPILED WebAssembly.Module imported as a CompiledWasm module.
// So: extract the wasm bytes to dist/yoga.wasm at build time, and shim
// `yoga-layout/load` to feed the imported module through the emscripten
// factory's `instantiateWasm` hook (supported by the glue — verified).
function findYogaDist(): string {
  const store = `${here}../../../node_modules/.deno`;
  for (const e of Deno.readDirSync(store)) {
    if (e.name.startsWith("yoga-layout@")) {
      return `${store}/${e.name}/node_modules/yoga-layout/dist`;
    }
  }
  throw new Error("yoga-layout not found in node_modules/.deno");
}
const yogaDist = findYogaDist();

async function extractYogaWasm(): Promise<void> {
  const glue = await Deno.readTextFile(`${yogaDist}/binaries/yoga-wasm-base64-esm.js`);
  const matches = [...glue.matchAll(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/g)];
  if (matches.length === 0) throw new Error("no base64 wasm payload found in yoga glue");
  const b64 = matches.map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  await Deno.mkdir(`${here}../dist`, { recursive: true });
  await Deno.writeFile(`${here}../dist/yoga.wasm`, bytes);
  console.log(`yoga.wasm: ${(bytes.length / 1024).toFixed(0)} KB extracted`);
}
await extractYogaWasm();

const yogaWasmShim: esbuild.Plugin = {
  name: "yoga-wasm-shim",
  setup(build) {
    build.onResolve({ filter: /^yoga-layout\/load$/ }, () => ({
      path: "yoga-layout/load",
      namespace: "yoga-wasm-shim",
    }));
    // Keep "./yoga.wasm" literal in the output: wrangler resolves it next to
    // dist/worker.js and compiles it via the CompiledWasm rule.
    build.onResolve({ filter: /^\.\/yoga\.wasm$/ }, () => ({
      path: "./yoga.wasm",
      external: true,
    }));
    // Absolute import paths: the Deno loader resolves relative specifiers
    // against the importer (a virtual module here), ignoring resolveDir.
    build.onLoad({ filter: /.*/, namespace: "yoga-wasm-shim" }, () => ({
      loader: "js",
      contents: `
import wasmModule from "./yoga.wasm";
import loadYogaImpl from "${yogaDist}/binaries/yoga-wasm-base64-esm.js";
import wrapAssembly from "${yogaDist}/src/wrapAssembly.js";
export async function loadYoga() {
  const impl = await loadYogaImpl({
    instantiateWasm(imports, receive) {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      receive(instance);
      return instance.exports;
    },
  });
  return wrapAssembly(impl);
}
export * from "${yogaDist}/src/generated/YGEnums.js";
`,
    }));
  },
};

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
  plugins: [nodeBuiltinShims, reactPdfBrowserBuilds, yogaWasmShim, denoPlugin()],
});

const outBytes = (await Deno.stat(`${here}../dist/worker.js`)).size;
console.log(`worker.js: ${(outBytes / 1024 / 1024).toFixed(2)} MB (pre-gzip)`);
await Deno.writeTextFile(`${here}../dist/metafile.json`, JSON.stringify(result.metafile));
await esbuild.stop();
