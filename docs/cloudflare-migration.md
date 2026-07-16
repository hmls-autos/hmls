# Cloudflare-native migration plan (HMLS)

**Scope (decided):** Move the **HMLS API + agent** off Deno Deploy onto Cloudflare Workers. This is
a **split**, not a full lift.

- **API + agent** (Hono) → **Cloudflare Workers** (workerd runtime).
- **Web** (Next.js 16) → **stays on Vercel, unchanged.** OpenNext is a compatibility shim over a
  Vercel-owned framework with real adapter tax (ISR→R2/DO, cold-start quirks, lag on new Next
  releases like the [Next-16 Proxy issue](https://github.com/cloudflare/workers-sdk/issues/13755));
  the web is the worst effort:risk in this migration and gains little from moving. Only change:
  repoint `GATEWAY_URL` at the new Workers API + confirm gateway CORS allows the Vercel origin.
- **DB** stays **Supabase Postgres** — Workers connect **directly to its transaction-mode pooler**
  (port 6543) via `postgres-js` under `nodejs_compat`. No Hyperdrive; it's an optional latency add
  later, not a second database.
- **Auth** stays **Supabase Auth** — unchanged. It already runs on workerd (`auth.getUser()` is a
  `fetch`; the web's `@supabase/ssr` is edge-compatible). (WorkOS was considered and shelved — kept
  here as a future note, not this migration.)
- **Fixo is deferred** — it stays on Deno Deploy behind `api.fixo.ink` (owns the ffmpeg subprocess
  blocker). Hostname routing isolates it at the _request_ layer — but **NOT at the bundle layer**:
  HMLS code imports `fixo-brain`, dragging the fixo diagnosis agent (and its ffmpeg tool) into the
  worker graph. Real isolation needs the decoupling in blocker #8 below.

**Runtime decision:** the HMLS runtime _changes_ to workerd — we are not keeping Deno as a target.
Local dev becomes `wrangler dev`. Deno remains only for (a) Fixo, (b) CLI scripts (drizzle-kit,
scrape-olp), which never deploy.

---

## Status — implemented & verified in this branch

All Deno-side changes pass `deno check`, `deno test`, `deno fmt`, `deno lint`. **Caveat (from
review):** `deno check` covers `index.ts`/`mod.ts` but **not** `worker.ts` (it's outside that graph
— validated only by wrangler/tsc, not run here). And a `deno check`-green tree does **not** mean the
Worker builds — the review found build blockers **C1–C4** (below) that fail `wrangler deploy` today.
Treat the ✅ items as "Deno-side sound," not "deploys."

| Done | Item                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | `env()` shim — [env.ts](../packages/shared/src/lib/env.ts), exported as `@hmls/shared/env`                                            |
| ✅   | Swept `Deno.env.get` → `env()` across 13 HMLS files (28 sites)                                                                        |
| ✅   | DB client reads `DATABASE_URL`/`TENANT_DATABASE_URL` via `env()` + `prepare:false` — [client.ts](../packages/shared/src/db/client.ts) |
| ✅   | Skills off the filesystem → [skills-bundle.ts](../apps/agent/src/hmls/skills-bundle.ts) (generator + drift test)                      |
| ✅   | Workers entrypoint `fetch`+`scheduled` — [worker.ts](../apps/gateway/src/worker.ts)                                                   |
| ✅   | [wrangler.jsonc](../apps/gateway/wrangler.jsonc) — nodejs_compat, cron, DB via secrets                                                |
| ⏳   | Spikes (react-pdf on workerd, direct Supabase connection) — need CF account                                                           |
| ⏳   | DNS cutover + repoint web `GATEWAY_URL` at Workers API                                                                                |
| —    | Web: stays on Vercel (no work)                                                                                                        |
| —    | Auth: stays Supabase (no work)                                                                                                        |

---

## ⚠️ Blockers found in adversarial code review (the first draft missed these)

A 6-reviewer pass verified this plan against the actual module graph. Four blockers were missed —
**two fail the build before runtime**:

**C1 — `@logtape/logtape` is JSR-only (BUILD BLOCKER).** Declared in `deno.json` (JSR), imported by
~20 files in the worker graph starting at `worker.ts`. wrangler/esbuild uses **Node resolution and
does not read `deno.json`** → bare specifier unresolvable → build fails. (Runtime compat is fine;
logtape v2 runs on workerd.)

**C2 — `@hmls/agent/*` is unresolvable under wrangler (BUILD BLOCKER).** `apps/agent` is a
Deno-workspace package with **no `package.json`** and isn't in the root npm workspaces — only
`@hmls/shared` is symlinked into `node_modules`. Every `@hmls/agent/*` import in the worker graph
fails Node resolution.

→ **C1+C2 mean the build strategy itself needs a bridge — see [Build pipeline](#build-pipeline)
below.** Neither is runnable-around; fix before any Phase 0 spike.

**C3 — `env()` module-init timing (RUNTIME BLOCKER).** `runWithEnv` only populates the ALS inside
`fetch`/`scheduled`. But `setupLogging()` and `createHmlsApp()` run at **module top-level** (isolate
startup), where the ALS store is empty and `process.env` isn't reliably populated on workerd →
`env()` returns `undefined`. Casualties: Stripe webhook route silently never mounts
(`hmls-app.ts:85`), OLP lookups sent unauthenticated (`olp-client.ts:6-8`), notification URLs freeze
to defaults (`notifications.ts:44-54`), `LOG_LEVEL` ignored (`logger.ts:6`). Fix: make all
module-init env reads **lazy/request-time** (mount webhook unconditionally — it re-checks the key at
request time anyway; convert OLP + notification module constants to lazy getters).

**C4 — `env()` ALS across the streamed response body (RUNTIME BLOCKER, needs spike).** `chat.ts`
returns a **lazy** `toUIMessageStreamResponse()` stream; the agent loop + tenant tool calls run as
the runtime _pulls the body_, **after `als.run` has returned**. The tenant DB client is created
lazily on first tenant query (cold isolate) — its first `env()` read happens mid-stream. If ALS
doesn't propagate across the body pull, the first tenant-scoped tool call throws → customer chat
breaks. Must be spiked with a real streamed turn; fallback is to warm the tenant DB URL
synchronously inside `fetch` (or close over `env` instead of relying on ALS during stream
production).

**Also corrected in this doc from the review:** Fixo is _not_ isolated by route-mounting
(bundle-graph leak via `@hmls/agent/fixo-brain`, below); react-pdf risk is **import-time** not
call-time; the env table omitted `RESEND_API_KEY` / `OLP_WORKER_URL` / `OLP_WORKER_SECRET`;
`DATABASE_URL` differs by consumer (Worker=6543 txn pooler; CLI/drizzle=5432 session); `worker.ts`
is validated by wrangler/tsc, not `deno check`.

## Build pipeline

wrangler's default esbuild bundling can't resolve this Deno codebase (C1/C2). Options:

- **(Recommended) esbuild + a Deno-loader plugin** (`jsr:@deno/esbuild-plugin` /
  `esbuild-deno-loader`): resolves `deno.json` imports, JSR deps, and the `@hmls/*` workspace, emits
  a single Worker bundle; wrangler deploys the pre-built file (`--no-bundle` / `main` → build
  output). Keeps the Deno codebase intact.
- **Alternative — npm-ify:** give `apps/agent` a `package.json` (exports mirroring `deno.json`), add
  it to root npm workspaces, and depend on npm builds of the JSR deps. More invasive, fights the
  Deno setup.

Recommend the esbuild-deno-loader build step. This is the real Phase 1 prerequisite.

---

## Target architecture

| Component                                | Today                                | Cloudflare-native                                                                                 |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| API + agent (Hono)                       | Deno Deploy `hmls-api`, `Deno.serve` | **Workers** — `export default { fetch, scheduled }`                                               |
| Web (Next.js 16)                         | Vercel                               | **stays on Vercel** — only repoint `GATEWAY_URL`                                                  |
| DB (Supabase PG + Drizzle + postgres-js) | raw TCP                              | **direct to Supabase pooler** (6543) → `postgres-js` (`prepare:false`); Hyperdrive optional later |
| Env / secrets (`Deno.env.get` ×55)       | process env                          | **`env` binding** via `runWithEnv` ALS shim                                                       |
| Cron (`Deno.cron` daily reap)            | Deno Deploy                          | **Cron Trigger** → `scheduled()` handler                                                          |
| Skills (`.skills/*.md` off disk)         | `Deno.readTextFile`                  | **plain string constants** in `skills-bundle.ts` (generated from `.md`)                           |
| PDF (`@react-pdf/renderer`)              | `renderToBuffer`                     | **spike on workerd (import-time risk); sidecar + dynamic import fallback**                        |
| Auth                                     | Supabase Auth                        | **unchanged** — `getUser()` is a `fetch`, works on workerd                                        |
| Fixo media                               | Supabase Storage                     | unchanged (Fixo deferred)                                                                         |

---

## Blocker matrix

| # | Blocker                                                                                                                                                                   | Files                                                                                                                                                                                                                             | Severity       | Fix                                                                                                                                                                                                                                                                                                                |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | `Deno.env.get` ×55 — no global env on Workers                                                                                                                             | gateway + agent + shared                                                                                                                                                                                                          | **needs shim** | ✅ `env()` shim committed ([env.ts](../packages/shared/src/lib/env.ts)); sweep call sites → `env()`                                                                                                                                                                                                                |
| 2 | `Deno.serve` + `Deno.cron`                                                                                                                                                | [index.ts:97,106,110](../apps/gateway/src/index.ts)                                                                                                                                                                               | trivial        | new `worker.ts` with `fetch` + `scheduled`; cron via `triggers.crons`                                                                                                                                                                                                                                              |
| 3 | `postgres-js` raw TCP                                                                                                                                                     | [client.ts](../packages/shared/src/db/client.ts)                                                                                                                                                                                  | needs-config   | `nodejs_compat` + Supabase transaction pooler (6543), `prepare:false`. Hyperdrive optional (latency only)                                                                                                                                                                                                          |
| 4 | `AsyncLocalStorage` (tx scoping + env shim)                                                                                                                               | client.ts, env.ts                                                                                                                                                                                                                 | needs-flag     | `nodejs_compat` covers it                                                                                                                                                                                                                                                                                          |
| 5 | `.skills/*.md` FS read                                                                                                                                                    | [load-skills.ts](../apps/agent/src/hmls/load-skills.ts)                                                                                                                                                                           | ✅ done        | vendored into [skills-bundle.ts](../apps/agent/src/hmls/skills-bundle.ts) (plain strings; no FS, no unstable flags) + drift test                                                                                                                                                                                   |
| 6 | `@react-pdf/renderer` — **import-time** risk (static top-level import, evaluated at isolate boot)                                                                         | [pdf-response.ts](../apps/gateway/src/lib/pdf-response.ts), [EstimatePdf.tsx](../apps/agent/src/hmls/pdf/EstimatePdf.tsx), routes `orders.ts`/`estimates.ts`                                                                      | **RISK**       | spike under `nodejs_compat`. If it breaks at module-eval, the **whole worker fails to boot** (not just the PDF route) — a sidecar doesn't rescue that, so the fix must ALSO make the react-pdf imports `dynamic import()` behind the PDF handlers                                                                  |
| 7 | `verifyToken` = per-request Supabase network call                                                                                                                         | [supabase.ts](../apps/gateway/src/lib/supabase.ts)                                                                                                                                                                                | ok             | works on workerd as-is. _Optional_ later: local JWKS verify (`jose`) to drop the per-request round-trip                                                                                                                                                                                                            |
| 8 | **Fixo bundle leak** — HMLS `create_order` + `orders.ts`/`mechanic.ts` import `fixo-brain`, which pulls `diagnoseStructured` → fixo agent → `extractVideoFrames` (ffmpeg) | [order.ts:39](../apps/agent/src/common/tools/order.ts), [orders.ts:21](../apps/gateway/src/routes/orders.ts), [mechanic.ts:10](../apps/gateway/src/routes/mechanic.ts) → [fixo-brain.ts:13](../apps/agent/src/fixo/fixo-brain.ts) | **major**      | ✅ barrel imports repointed to fixo-free subpaths. **TODO:** split DB-only telemetry (`openPrediction`/`recordEstimate`/`recordOutcome`) out of `fixo-brain.ts`; `fillPrediction` (runs the fixo agent) → drop on Worker or call Fixo brain over HTTP (the `brain-service.ts` contract was designed for this swap) |

**Build blockers C1–C4 (from the code review, above) are the true gating items — the matrix rows 1-8
are runtime/bundle; C1/C2 fail the build first.**

**Auth stays Supabase.** Nothing to migrate — `@supabase/supabase-js` `getUser()` and
`@supabase/ssr` both run on workerd. Note that RLS never depended on the IdP anyway (tenancy =
restricted PG role + `set_config('app.customer_id'/'app.shop_id')` GUCs, not `auth.uid()`), so a
future provider swap would stay contained — but that's not this migration.

---

## Env var → Cloudflare mapping (HMLS worker)

| Var                                                                                     | Cloudflare form  | Note                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` (service_role @ 6543)                                                    | **secret**       | admin/system/owner-all + bootstrap. ⚠️ Worker uses the **6543 txn pooler** (`prepare:false`); CLI scripts + drizzle-kit need the **5432 session** connection (DDL/prepared statements break on 6543) |
| `TENANT_DATABASE_URL` (restricted role @ 6543)                                          | **secret**       | RLS-enforcing. Two roles = two connection strings (same pooler host, different user)                                                                                                                 |
| `DEEPSEEK_API_KEY`                                                                      | secret           | HMLS agent                                                                                                                                                                                           |
| `RESEND_API_KEY`                                                                        | **secret**       | email notifications ([notifications.ts:396](../apps/agent/src/lib/notifications.ts)) — **was missing**                                                                                               |
| `OLP_WORKER_URL`                                                                        | **var**          | OLP labor/parts lookup endpoint ([olp-client.ts:6](../apps/agent/src/hmls/tools/olp-client.ts)) — **was missing**                                                                                    |
| `OLP_WORKER_SECRET`                                                                     | **secret**       | OLP lookup auth ([olp-client.ts:8](../apps/agent/src/hmls/tools/olp-client.ts)) — **was missing**                                                                                                    |
| `HMLS_AGENT_MODEL`                                                                      | var              | optional model override                                                                                                                                                                              |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                            | secret           | dormant but wired                                                                                                                                                                                    |
| `SLACK_WEBHOOK_URL`                                                                     | secret           | notifications                                                                                                                                                                                        |
| `LOG_LEVEL`                                                                             | var              | logtape (read lazily — see C3)                                                                                                                                                                       |
| `SUPABASE_URL/ANON_KEY`                                                                 | secret           | auth stays Supabase — keep                                                                                                                                                                           |
| `NOTIFY_FROM_EMAIL`, `ADMIN_NOTIFY_EMAIL`, `BASE_URL`, `PORTAL_URL`, `BUSINESS_ADDRESS` | var              | have defaults, but set them ([notifications.ts:44-54](../apps/agent/src/lib/notifications.ts))                                                                                                       |
| `GOOGLE_API_KEY`                                                                        | —                | **drop from HMLS worker** — Fixo-only; remove the boot guard for it                                                                                                                                  |
| `SKIP_AUTH`, `DEV_*`                                                                    | `.dev.vars` only | never in deployed env (keep the guard)                                                                                                                                                               |

Boot-time fail-fast guards in [index.ts:12-54](../apps/gateway/src/index.ts) move into the top of
`fetch()` (checked once) or are dropped where the getter already throws. **Per C3, module-init env
reads must become lazy** so they resolve at request time, not isolate-startup.

---

## Phase-by-phase (executable)

### Phase 0 — Spike the two unknowns (do first, ~1 day)

- [ ] `@react-pdf/renderer` `renderToBuffer` on `wrangler dev` with `nodejs_compat` — render one
      EstimatePdf. **Kills the biggest risk before mass edits.**
- [ ] `postgres-js` direct to Supabase pooler: one `SELECT 1` from a Worker over the **6543
      transaction pooler** (confirms TCP socket + `prepare:false` path).
- Decision gate: if PDF fails → adopt the sidecar plan (Phase 3b) before proceeding.

### Phase 1 — API Worker foundation

- [x] `env()` shim ([env.ts](../packages/shared/src/lib/env.ts)) + `@hmls/shared/env` export.
- [x] Sweep `Deno.env.get(` → `env(` across the 13 HMLS files (gateway non-fixo + agent hmls/lib +
      shared). Left Fixo, scripts, `index.ts`.
- [x] `apps/gateway/src/worker.ts` — entrypoint. Mounts **only** `createHmlsApp()`.
- [x] `apps/gateway/wrangler.jsonc` — `nodejs_compat`, cron, DB via secrets.
- [x] Kept `index.ts` as the Deno path for Fixo dev; HMLS local dev → `wrangler dev`.

### Phase 2 — DB (direct to Supabase, no Hyperdrive)

- [x] `client.ts` reads `TENANT_DATABASE_URL` / `DATABASE_URL` via `env()`,
      `postgres(url, { prepare: false })`.
- [ ] Set both as secrets, pointing at Supabase's **transaction pooler (port 6543)**: `DATABASE_URL`
      (service_role), `TENANT_DATABASE_URL` (restricted role).
- [ ] Confirm `withTenantScope` (a real tx with `set_config(..., true)`) works through transaction
      pooling — it does: the pooler pins the connection for the tx, so the GUC stays scoped.
- Hyperdrive is a later, optional latency add — one binding, no code change.

### Phase 3 — Skills + PDF

- [x] Skills vendored into `skills-bundle.ts` (plain strings, generated via
      `deno task --cwd apps/agent build:skills`); `load-skills.ts` reads `SKILL_BUNDLE`; drift
      guarded by `load-skills_test.ts`. No text-import, no wrangler `.md` rule.
- [ ] **PDF (only if Phase 0 import-time spike fails):** make `pdf-response.ts`/`EstimatePdf`
      imports `dynamic import()` behind the PDF route handlers so the core worker boots without
      react-pdf, and stand up a Node/Deno PDF sidecar the API calls over HTTP.

### Phase 4 — Cron

- [x] Daily `cancel_abandoned_drafts` reap is in `worker.ts` `scheduled()` (`ctx.waitUntil`,
      `runWithEnv`); `triggers.crons = ["0 3 * * *"]` in wrangler.jsonc.

### Phase 5 — Web (stays on Vercel)

No migration. Only wiring:

- [ ] Point the web's `GATEWAY_URL` (and `NEXT_PUBLIC_AGENT_URL` if used) at the new Workers API
      URL.
- [ ] Confirm gateway CORS allows the Vercel origin (`hmls.autos`) + the `Authorization` header.
      Auth uses Bearer tokens, not cookies, so no cross-site-cookie concerns.

### Phase 6 — Cutover

- [ ] Deploy API Worker; point `api.hmls.autos` DNS (Cloudflare zone `hmls.autos`) at it.
- [ ] Deploy web Worker; move `hmls.autos` off Vercel.
- [ ] Update Supabase Auth redirect URLs / CORS as needed.
- [ ] Leave `api.fixo.ink` on Deno Deploy untouched.

---

## Auth — stays Supabase (decided)

No migration work. `@supabase/supabase-js` `auth.getUser()` (gateway) and `@supabase/ssr` (web) both
run on workerd unchanged; `SUPABASE_URL/ANON_KEY` stay as secrets.

_Future note (not this migration):_ if we ever swap providers, it stays contained — RLS never used
the IdP (tenancy = restricted PG role + `set_config` GUCs, not `auth.uid()`), and role resolves from
`customers.role` app-side. Only optional near-term win: switch `verifyToken` to local JWKS
verification (`jose`) to drop the per-request Supabase round-trip.

---

## Config sketches

### `apps/gateway/wrangler.jsonc`

```jsonc
{
  "name": "hmls-api",
  "main": "src/worker.ts",
  "compatibility_date": "2025-07-01",
  "compatibility_flags": ["nodejs_compat"],
  "triggers": { "crons": ["0 3 * * *"] },
  "vars": { "HMLS_AGENT_MODEL": "deepseek-v4-pro", "LOG_LEVEL": "info" },
  "observability": { "enabled": true }
}
```

Secrets: `wrangler secret put DATABASE_URL` + `TENANT_DATABASE_URL` (both → Supabase 6543
transaction pooler), `DEEPSEEK_API_KEY`, `STRIPE_*`, `SLACK_WEBHOOK_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`.

### `apps/gateway/src/worker.ts`

```ts
import { runWithEnv } from "@hmls/shared/env";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@hmls/agent/db";
import { createHmlsApp } from "./hmls-app.ts";
import { setupLogging } from "./logger.ts";

await setupLogging();
const app = createHmlsApp();

export default {
  fetch(req: Request, env: unknown, ctx: ExecutionContext): Response | Promise<Response> {
    return runWithEnv(env as Record<string, unknown>, () => app.fetch(req, env as never, ctx));
  },
  scheduled(_e: ScheduledController, env: unknown, ctx: ExecutionContext): void {
    ctx.waitUntil(runWithEnv(env as Record<string, unknown>, async () => {
      await dbAdmin.execute(sql`SELECT cancel_abandoned_drafts(14)`);
    }));
  },
};
```

### `client.ts` connection (direct to Supabase pooler)

```ts
import { env } from "@hmls/shared/env";
const tenantUrl = env("TENANT_DATABASE_URL"); // restricted role @ 6543
const url = tenantUrl ?? env("DATABASE_URL"); // admin fallback (local/CI only)
drizzle(postgres(url, { prepare: false }), { schema }); // prepare:false ← transaction pooler
```

### Local dev

```bash
# API (now workerd) — put DATABASE_URL + TENANT_DATABASE_URL in apps/gateway/.dev.vars
cd apps/gateway && wrangler dev
# Web (unchanged — stays on Vercel/Next)
cd apps/hmls-web && GATEWAY_URL=http://localhost:8787 bun run dev
```

---

## Open questions (need a human call)

1. **Two DB roles** — two connection strings (service_role admin + restricted tenant, both @ 6543)
   keep fail-closed RLS role separation. Alternative: one role + GUC-only (weaker). Recommend two.
   (Independent of Hyperdrive.)
2. **react-pdf fallback shape** — if the spike fails: Cloudflare Container vs a small always-on
   Deno/Node PDF service. Recommend Container (stays in CF).
3. ~~WorkOS timing~~ — decided: auth stays Supabase, no change.
4. ~~Web on OpenNext~~ — decided: web stays on Vercel (split). No OpenNext work.
