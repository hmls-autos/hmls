// Cloudflare Workers entrypoint for the HMLS API (workerd runtime).
//
// Deno's `index.ts` stays the entrypoint for local combined dev + the Fixo app
// on Deno Deploy. This worker mounts ONLY the HMLS app — Fixo (which needs a
// subprocess for ffmpeg) is deferred and keeps running on Deno behind
// `api.fixo.ink`.
//
// Env, secrets, and bindings (Hyperdrive) arrive in the per-request `env`
// param — Workers have no process-global env. `runWithEnv` stashes it in an
// ALS so the deep code (db client, stripe, notifications) can read it via
// `env()`/`envBindings()` without threading `c.env` through every call.
//
// Type-checked by tsc + @cloudflare/workers-types via wrangler, NOT by
// `deno check` (it's outside the index.ts graph).
import { runWithEnv } from "@hmls/shared/env";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@hmls/agent/db";
import { getLogger } from "@logtape/logtape";
import { createHmlsApp } from "./hmls-app.ts";
import { createFixoApp } from "./fixo-app.ts";
import { setupLogging } from "./logger.ts";

const logger = getLogger(["hmls", "gateway", "worker"]);
const hmlsApp = createHmlsApp();
const fixoApp = createFixoApp();

// Hostname dispatch mirrors index.ts (the Deno path): api.fixo.* → fixoApp,
// everything else → the HMLS app. Fixo shares this worker rather than a second
// deployment (one worker = one DB client pair). The fixo agent's ffmpeg tool is
// stubbed (video shelved), so no subprocess is needed. If the combined bundle
// ever busts the 10 MB gzip limit, split fixoApp into its own worker.
const FIXO_HOSTS = ["api.fixo.hmls.autos", "api.fixo.ink", "fixo.localhost"];

// deno-lint-ignore no-explicit-any
function dispatch(req: Request, env: any, ctx: any): Response | Promise<Response> {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  if (FIXO_HOSTS.includes(host)) return fixoApp.fetch(req, env, ctx);

  // Path-based /fixo/* fallback (strip the prefix), same as index.ts.
  const url = new URL(req.url);
  if (url.pathname === "/fixo" || url.pathname.startsWith("/fixo/")) {
    const newPath = url.pathname.slice("/fixo".length) || "/";
    return fixoApp.fetch(new Request(new URL(newPath + url.search, url.origin), req), env, ctx);
  }

  return hmlsApp.fetch(req, env, ctx);
}

// Logging is configured on the first request, not at isolate init: LOG_LEVEL
// arrives in the per-request env bindings, which env() can only see inside a
// runWithEnv scope (C3 in docs/cloudflare-migration.md). getLogger() calls
// before configure() are fine — logtape buffers category objects and binds
// sinks when configure() runs.
let loggingReady: Promise<void> | undefined;
const ensureLogging = () => (loggingReady ??= setupLogging());

export default {
  // deno-lint-ignore no-explicit-any
  fetch(req: Request, env: any, ctx: any): Promise<Response> {
    return runWithEnv(env, async () => {
      await ensureLogging();
      return dispatch(req, env, ctx);
    });
  },

  // Daily reap of abandoned draft orders — replaces the `Deno.cron` job in
  // index.ts. Wired to `triggers.crons` in wrangler.jsonc. Uses dbAdmin
  // (service_role, bypasses RLS): a system job across all shops with no tenant
  // GUC set. See migration 0034 `cancel_abandoned_drafts`.
  // deno-lint-ignore no-explicit-any
  scheduled(_event: any, env: any, ctx: any): void {
    ctx.waitUntil(
      runWithEnv(env, async () => {
        await ensureLogging();
        try {
          const rows = await dbAdmin.execute(sql`SELECT cancel_abandoned_drafts(14) AS n`);
          const n = (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
          logger.info("cancel-abandoned-drafts: cancelled {n} order(s)", { n });
        } catch (err) {
          logger.error("cancel-abandoned-drafts cron failed: {err}", { err });
        }
      }),
    );
  },
};
