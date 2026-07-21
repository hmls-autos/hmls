import { AsyncLocalStorage } from "node:async_hooks";

// Runtime-agnostic env access. Deno reads a process-global (`Deno.env`);
// Cloudflare Workers have no such global — env vars, secrets, and bindings
// arrive per-request in the `fetch(req, env, ctx)` parameter. This shim lets
// the same code run on both: the Workers entrypoint stashes `env` in an ALS
// for the duration of the request (see runWithEnv), and env() reads from
// there first, falling back to Deno.env / process.env for local dev, CLI
// scripts, and the still-on-Deno Fixo app.

// deno-lint-ignore no-explicit-any
type EnvRecord = Record<string, any>;
const als = new AsyncLocalStorage<EnvRecord>();

/** Bind a Workers `env` object for the duration of `fn` (one request or cron
 *  invocation). No-op semantics on Deno/Node — env() just falls back. */
export function runWithEnv<T>(bindings: EnvRecord, fn: () => T): T {
  return als.run(bindings, fn);
}

/** Read a string env var. Workers request bindings → Deno.env → process.env. */
export function env(key: string): string | undefined {
  const store = als.getStore();
  if (store && key in store && typeof store[key] === "string") {
    return store[key] as string;
  }
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  if (g.Deno?.env) return g.Deno.env.get(key);
  if (g.process?.env) return g.process.env[key];
  return undefined;
}
