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
import { setupLogging } from "./logger.ts";

const logger = getLogger(["hmls", "gateway", "worker"]);
const app = createHmlsApp();

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
      return app.fetch(req, env, ctx);
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
