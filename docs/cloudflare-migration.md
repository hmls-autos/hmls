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

**2026-07-17 update: C1–C4 and blockers #6/#8 are all FIXED and verified on local workerd
(`wrangler dev` / miniflare).** The worker builds, boots, serves `/health`, runs `SELECT 1` through
postgres-js, renders a real EstimatePdf via react-pdf + yoga wasm, and the env() ALS survives the
streamed-body pull. The one thing local dev could NOT verify is postgres-js **TLS** to the Supabase
pooler (miniflare's `startTls` emulation hangs; raw TCP + PG `SSLRequest` handshake to the 6543
pooler works and returns `'S'`) — that needs one verification on deployed workerd.

| Done | Item                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | `env()` shim — [env.ts](../packages/shared/src/lib/env.ts), exported as `@hmls/shared/env`                                            |
| ✅   | Swept `Deno.env.get` → `env()` across 13 HMLS files (28 sites)                                                                        |
| ✅   | DB client reads `DATABASE_URL`/`TENANT_DATABASE_URL` via `env()` + `prepare:false` — [client.ts](../packages/shared/src/db/client.ts) |
| ✅   | Skills off the filesystem → [skills-bundle.ts](../apps/agent/src/hmls/skills-bundle.ts) (generator + drift test)                      |
| ✅   | Workers entrypoint `fetch`+`scheduled` — [worker.ts](../apps/gateway/src/worker.ts)                                                   |
| ✅   | [wrangler.jsonc](../apps/gateway/wrangler.jsonc) — nodejs_compat, cron, `no_bundle` + CompiledWasm rule                               |
| ✅   | **C1+C2**: build pipeline — [build-worker.ts](../apps/gateway/scripts/build-worker.ts) (esbuild + @deno/esbuild-plugin)               |
| ✅   | **C3**: module-init env reads made lazy (webhook mount, olp-client, notifications, logging)                                           |
| ✅   | **C4**: verified on workerd — ALS readable in stream pull; tenant client created mid-pull OK                                          |
| ✅   | **#6**: react-pdf renders on workerd (browser builds for pdfkit/png-js/image + yoga wasm as CompiledWasm module)                      |
| ✅   | **#8**: fixo agent out of the eager worker graph ([prediction-log.ts](../apps/agent/src/fixo/prediction-log.ts) split)                |
| ✅   | `/health/db` probe route (SELECT 1 via admin pool) for cutover verification                                                           |
| ⏳   | Verify postgres-js TLS to the 6543 pooler on DEPLOYED workerd (local miniflare `startTls` hangs — likely local-only)                  |
| ⏳   | CF account setup: `wrangler secret put` (see env table), first deploy, workers.dev smoke test                                         |
| ⏳   | DNS cutover + repoint web `GATEWAY_URL` at Workers API                                                                                |
| ⏳   | Decide: `GOOGLE_API_KEY` on the worker? (live `diagnose_symptom` in customer chat fails soft → null without it)                       |
| —    | Web: stays on Vercel (no work)                                                                                                        |
| —    | Auth: stays Supabase (no work)                                                                                                        |

### Local dev (workerd)

```bash
deno task build:worker                     # bundle dist/worker.js + dist/yoga.wasm
cd apps/gateway && wrangler dev            # .dev.vars holds DATABASE_URL etc. (gitignored)
curl localhost:8787/health/db              # DB probe
```

`.dev.vars` note: point `DATABASE_URL`/`TENANT_DATABASE_URL` at a LOCAL Postgres for wrangler dev —
TLS to the real Supabase pooler hangs under miniflare (see above), and prod-DB-from-dev is banned
anyway (ops runbook).

---

## ⚠️ Blockers found in adversarial code review — ALL FIXED 2026-07-17

A 6-reviewer pass verified this plan against the actual module graph. Four blockers were missed —
**two fail the build before runtime**. Kept for the record; every one is now resolved (see the
status table above for the fixes):

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

**DECIDED + IMPLEMENTED (2026-07-17):** the esbuild + `@deno/esbuild-plugin` route —
[build-worker.ts](../apps/gateway/scripts/build-worker.ts), run via `deno task build:worker`.
Output: `dist/worker.js` (~9 MB raw / ~1.6 MB gzip, well under the 10 MB paid limit) +
`dist/yoga.wasm`; wrangler deploys them with `no_bundle` + `find_additional_modules`. Three
build-time shims proved necessary on top of the loader (all in build-worker.ts):

1. **node-builtin-shims** — CJS deps (`queue`, `crypto-js`) require bare `"events"`/`"crypto"`; left
   external those become `__require()` bombs that throw at isolate boot. Bare ids are rewritten to
   bundled modules re-exporting the workerd-supported `node:*` equivalent. `fs` → empty stub (only
   @react-pdf/renderer's never-called `renderToFile` touches it).
2. **react-pdf-browser-builds** — the Deno loader resolves Node `main` entries and ignores the
   package.json `browser` field; @react-pdf/pdfkit, png-js, and image get their fs-free browser
   builds swapped in. The renderer keeps its Node build (its browser build stubs `renderToBuffer`
   with a throw).
3. **yoga-wasm-shim** — yoga-layout is emscripten wasm instantiated from base64 at runtime, which
   workerd forbids ("Wasm code generation disallowed"). The wasm bytes are extracted to
   `dist/yoga.wasm` (a CompiledWasm module) and `yoga-layout/load` is shimmed to feed the
   pre-compiled `WebAssembly.Module` through the emscripten `instantiateWasm` hook.

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
| PDF (`@react-pdf/renderer`)              | `renderToBuffer`                     | **✅ renders natively on workerd** (browser builds + yoga CompiledWasm — no sidecar needed)       |
| Auth                                     | Supabase Auth                        | **unchanged** — `getUser()` is a `fetch`, works on workerd                                        |
| Fixo media                               | Supabase Storage                     | unchanged (Fixo deferred)                                                                         |

---

## Blocker matrix

| # | Blocker                                                                                                                                                                   | Files                                                                                                                                                                                                                             | Severity       | Fix                                                                                                                                                                                                                                                                                                                                                                                      |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `Deno.env.get` ×55 — no global env on Workers                                                                                                                             | gateway + agent + shared                                                                                                                                                                                                          | **needs shim** | ✅ `env()` shim committed ([env.ts](../packages/shared/src/lib/env.ts)); sweep call sites → `env()`                                                                                                                                                                                                                                                                                      |
| 2 | `Deno.serve` + `Deno.cron`                                                                                                                                                | [index.ts:97,106,110](../apps/gateway/src/index.ts)                                                                                                                                                                               | trivial        | new `worker.ts` with `fetch` + `scheduled`; cron via `triggers.crons`                                                                                                                                                                                                                                                                                                                    |
| 3 | `postgres-js` raw TCP                                                                                                                                                     | [client.ts](../packages/shared/src/db/client.ts)                                                                                                                                                                                  | needs-config   | `nodejs_compat` + Supabase transaction pooler (6543), `prepare:false`. Hyperdrive optional (latency only)                                                                                                                                                                                                                                                                                |
| 4 | `AsyncLocalStorage` (tx scoping + env shim)                                                                                                                               | client.ts, env.ts                                                                                                                                                                                                                 | needs-flag     | `nodejs_compat` covers it                                                                                                                                                                                                                                                                                                                                                                |
| 5 | `.skills/*.md` FS read                                                                                                                                                    | [load-skills.ts](../apps/agent/src/hmls/load-skills.ts)                                                                                                                                                                           | ✅ done        | vendored into [skills-bundle.ts](../apps/agent/src/hmls/skills-bundle.ts) (plain strings; no FS, no unstable flags) + drift test                                                                                                                                                                                                                                                         |
| 6 | `@react-pdf/renderer` — **import-time** risk (static top-level import, evaluated at isolate boot)                                                                         | [pdf-response.ts](../apps/gateway/src/lib/pdf-response.ts), [EstimatePdf.tsx](../apps/agent/src/hmls/pdf/EstimatePdf.tsx), routes `orders.ts`/`estimates.ts`                                                                      | ✅ done        | verified on wrangler dev: boots AND renders a real EstimatePdf. Needed browser builds for pdfkit/png-js/image, an empty `fs` stub for the renderer, and yoga wasm as a CompiledWasm module (see Build pipeline). No sidecar, no dynamic import needed                                                                                                                                    |
| 7 | `verifyToken` = per-request Supabase network call                                                                                                                         | [supabase.ts](../apps/gateway/src/lib/supabase.ts)                                                                                                                                                                                | ok             | works on workerd as-is. _Optional_ later: local JWKS verify (`jose`) to drop the per-request round-trip                                                                                                                                                                                                                                                                                  |
| 8 | **Fixo bundle leak** — HMLS `create_order` + `orders.ts`/`mechanic.ts` import `fixo-brain`, which pulls `diagnoseStructured` → fixo agent → `extractVideoFrames` (ffmpeg) | [order.ts:39](../apps/agent/src/common/tools/order.ts), [orders.ts:21](../apps/gateway/src/routes/orders.ts), [mechanic.ts:10](../apps/gateway/src/routes/mechanic.ts) → [fixo-brain.ts:13](../apps/agent/src/fixo/fixo-brain.ts) | ✅ done        | DB-only telemetry split into [prediction-log.ts](../apps/agent/src/fixo/prediction-log.ts) (`@hmls/agent/prediction-log`); `fillPrediction` + `diagnose_symptom`'s transport are call-site dynamic imports (lazy `__esm` in the bundle — never evaluated at boot, fail-soft on workerd without `GOOGLE_API_KEY`). Verified via metafile: zero eager import edges into fixo/ from outside |

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

- [x] `@react-pdf/renderer` `renderToBuffer` on `wrangler dev` with `nodejs_compat` — **rendered a
      valid 2-page EstimatePdf** (needed the three build shims; see Build pipeline).
- [x] `postgres-js` from workerd: `SELECT 1` works (verified against local Postgres, plaintext).
      **Caveat:** against the real 6543 pooler with `sslmode=require`, miniflare hangs inside
      postgres-js's `startTls` upgrade — while a raw `cloudflare:sockets` PG `SSLRequest` handshake
      to the same pooler succeeds (`'S'` returned). Conclusion: TCP + endpoint fine; the TLS hang is
      in miniflare's local socket emulation. Re-verify TLS once on DEPLOYED workerd via
      `/health/db`.
- [x] **C4 (ALS across the streamed body)**: verified on workerd — a lazy `ReadableStream` `pull`
      created inside `runWithEnv` still reads `env()` fine after `als.run` returns, and the tenant
      DB client's lazy first-creation mid-pull succeeds. No fetch-time warm-up needed.
- ~~Decision gate: if PDF fails → sidecar~~ — PDF passed; sidecar plan retired.

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
- [x] **PDF:** renders natively on workerd — no sidecar, no dynamic import. Handled entirely at
      build time (browser builds for pdfkit/png-js/image, empty `fs` stub, yoga wasm as a
      CompiledWasm module — see Build pipeline).

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

- [ ] `wrangler secret put` the env table below; first `wrangler deploy`; smoke-test the workers.dev
      URL (`/health`, `/health/db` — settles the TLS caveat, PDF route, one chat turn).
- [ ] Point `api.hmls.autos` DNS (Cloudflare zone `hmls.autos`) at the Worker; repoint web
      `GATEWAY_URL`.
- [ ] Update Supabase Auth redirect URLs / CORS as needed.
- [ ] Leave `api.fixo.ink` on Deno Deploy untouched (web stays on Vercel — split decision above).

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
4. ~~Web on OpenNext~~ — ~~decided: web stays on Vercel (split). No OpenNext work.~~ **REVERSED
   2026-07-19: going full Cloudflare — both webs move to Workers via OpenNext, Fixo API moves too.
   See "Full migration (phase 2+)" below.**

---

## Full migration (phase 2+)

PR #146 put the HMLS API on Cloudflare Workers. This section takes the rest — both web apps and the
Fixo API — onto Cloudflare too. **DB stays Supabase Postgres, Auth stays Supabase GoTrue** (see
"What we are NOT changing"). Phases are ordered by risk: prove the OpenNext/Next-16 path on the app
with the fewest moving parts, then the one with middleware+PWA, then the heaviest new infra (Fixo
agent + ffmpeg container).

### Progress (2026-07-19)

| Phase                    | State                                          | Notes                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — hmls-web**         | ✅ code + local workerd verify; deploy pending | next 16.2.10; OpenNext scaffold; geo→request.cf. Verified: SSG, /api/geo real coords, OG PNG, next/image, /chat shell, /api/chat 405.                                                                                                                                                                                                 |
| **2 — fixo-web**         | ✅ code + local workerd verify; deploy pending | next 16.2.10; **dropped next-pwa** (webpack-only SW blocks turbopack; manifest-only PWA kept); OG fonts **base64-embedded** (OpenNext runs the param-less metadata route dynamically → no fs/file:// on workerd). Verified: SSG, both OG PNGs render with Geist, middleware runs, manifest.                                           |
| **3 — Fixo API**         | ✅ code + local workerd verify; deploy pending | env swap done; worker.ts mounts fixoApp w/ hostname dispatch; ffmpeg tool dropped (video shelved); HMLS webhook → constructEventAsync. **Bundle gate: 1.72 MB gzip → single worker, no split.** Verified dispatch (default→hmls, fixo.localhost→fixo, /v1→401). Deep fixo needs GOOGLE_API_KEY + SUPABASE_SERVICE_ROLE_KEY → cutover. |
| **4 — ffmpeg Container** | **SHELVED (decided 2026-07-19)**               | Video is dead code (`/input/init` rejects non-photo; `extractVideoFrames` has no live caller). Phase 3 just stubs the tool. Build the Container only if/when video ships.                                                                                                                                                             |
| **5 — CI/secrets/DNS**   | pending                                        | Needs the deploy machine (CF account/wrangler auth) + the fixo.ink zone-account resolution.                                                                                                                                                                                                                                           |

Deploys happen on the machine with CF account / wrangler auth. This branch's work is code + config

- local-workerd verification; `cf:deploy`, `NEXT_PUBLIC_*` build env, DNS cutover, and the live
  Supabase-middleware/SSE checks are done there.

**Deploy is deliberately the LAST step (decided 2026-07-20).** Phases 1-3 are code-complete and
local-workerd-verified; the entire deploy apparatus — CI/secrets scaffolding, `wrangler deploy`,
smoke tests, and DNS cutover — is held for one final pass (Phase 5). Prereqs to line up before it:
`infisical login` (prod secrets), the fixo.ink zone-account resolution (custom domain needs
same-account zone), and a `CLOUDFLARE_API_TOKEN` for CI.

### Cross-cutting decisions (make these before Phase 1)

| Decision                             | Recommendation                                                                                                                                                                                                                     | Why                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **fixo.ink zone account**            | Confirm which CF account owns it; consolidate into the deploying account (registrar NS change) **before** any fixo cutover                                                                                                         | Worker Custom Domains require the zone in the same CF account. This has the longest lead time (propagation) — start it now. |
| **Single vs multiple workers (API)** | Share one `hmls-api` worker via hostname dispatch (port `index.ts:60-77` into `worker.ts`); split Fixo out **only if** the gzipped bundle busts the 10 MB Workers limit                                                            | Smallest diff, matches today's single-process model, keeps one DB client pair (flat connection count)                       |
| **Hyperdrive**                       | **No.** Supavisor 6543 already pools; Hyperdrive adds an RLS caching foot-gun (query-cache keyed by SQL text can leak cross-tenant rows on unscoped reads) for pooling we already have                                             | Revisit only if cold-connect latency is _measured_ as a real problem                                                        |
| **Keep PWA (fixo-web)**              | Keep `next-pwa` for the first cut via `buildCommand: "next build --webpack"`; reassess to manifest-only after                                                                                                                      | Offline chat is not a proven product requirement; webpack-coupling blocks turbopack                                         |
| **Containers (ffmpeg)**              | **Defer entirely.** Stub the tool on workerd. Build the container only when video upload actually ships                                                                                                                            | `extractVideoFrames` is dead code today (`input.ts:265` rejects video, `hydrate-media.ts:104` skips it)                     |
| **CI/deploy**                        | Cloudflare Workers Builds (native git integration, per worker) — like-for-like replacement for the Vercel + Deno Deploy git integrations, free PR previews. Fallback: one `deploy.yml` matrix with `cloudflare/wrangler-action@v3` | Keeps "no deploy YAML" ergonomics; `ci.yml` stays as the quality gate                                                       |
| **Secrets**                          | Configure Infisical→Cloudflare Workers integration (or ship `scripts/sync-cf-env.sh` = `infisical export` → `wrangler secret bulk`). Web `NEXT_PUBLIC_*` must be **build-env** vars, not runtime secrets                           | Today's Infisical→Vercel + `sync-deno-env.sh` paths both disappear                                                          |
| **DNS cutover order**                | Least-risky first: (1) api.hmls.autos [done in #146] → (2) hmls.autos apex → (3) api.fixo.ink → (4) fixo.ink apex. Attach Worker Custom Domain in-dashboard (atomic repoint)                                                       | Verify each before the next; keep old targets alive for rollback                                                            |

---

### Phase 1 — hmls-web → Workers (de-risk the OpenNext/Next-16 path)

**Goal:** Prove OpenNext + Next 16 on the lowest-risk app. No middleware, no ISR, no runtime image
optimizer, only 2 SSG dynamic routes. If OpenNext can't carry this app, it can't carry fixo-web —
fail fast here.

**Steps:**

1. Bump `apps/hmls-web/package.json` next `16.2.4 → 16.2.10`. **Hard prerequisite:**
   `@opennextjs/cloudflare` peer dep is `>=15.5.18 <16 || >=16.2.6` — 16.2.4 is in the unsupported
   gap. `bun install && bun run build && bun run typecheck`.
2. Add dev deps `@opennextjs/cloudflare` + `wrangler`. Create `apps/hmls-web/open-next.config.ts` =
   `export default defineCloudflareConfig({})` (no cache backends — zero ISR means no R2/KV/D1).
   **Keep `output:"standalone"`** in `next.config.ts` (adapter requires it).
3. Create `apps/hmls-web/wrangler.jsonc`: `name:"hmls-web"`, `main:".open-next/worker.js"`,
   `compatibility_flags:["nodejs_compat"]`, assets binding → `.open-next/assets`. Add
   `preview`/`deploy` scripts wrapping `opennextjs-cloudflare`.
4. Rewrite `app/api/geo/route.ts`: it reads Vercel-only `x-vercel-ip-latitude/longitude` → always
   null on CF. Switch to `getCloudflareContext().cf?.latitude/.longitude` (or
   `cf-iplatitude`/`cf-iplongitude` headers). ~5 lines; preserve the null-fallback contract so
   `RealMap.tsx` is unaffected.
5. Wire env: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_AGENT_URL`
   at **build time** (silent-failure trap: a missing one ships a client that throws at runtime —
   gate the build on all three). `GATEWAY_URL` as a Worker runtime var pointing at the CF API
   worker.
6. `opennextjs-cloudflare preview` (workerd) and verify the full surface, not just that it compiles.

**Gate (must pass before Phase 2):**

- SSG marketing pages (`areas/[city]`, `services/[service]`) serve
- **`/api/chat` + `/api/staff-chat` SSE streaming end-to-end incl. `req.signal` abort**
  (highest-value smoke test — these proxies exist specifically for iOS Safari same-origin SSE)
- `/auth/callback` + `/auth/confirm` cookie exchange (Supabase SSR + `next/headers`)
- `next/image` serves pre-gen webp from assets; `icon.tsx` + `opengraph-image.tsx` confirmed
  prerendered to static PNG (not pulling satori/resvg onto the worker)
- `/api/geo` fallback works

**Effort:** ~half a day for the app + buffer for env plumbing and DNS cutover.

---

### Phase 2 — fixo-web → Workers (middleware + PWA + OG fonts)

**Goal:** The harder web app. Supabase edge middleware, `next-pwa` service worker, two
`opengraph-image` routes with runtime font fetches, `runtime="edge"` on one OG route. Only start
once Phase 1's OpenNext path is proven.

**Steps:**

1. Bump next `16.1.6 → >=16.2.6` (same unsupported-gap blocker). `bun install`,
   `next build --webpack`, typecheck.
2. Delete `export const runtime = "edge"` from `src/app/opengraph-image.tsx:3` — OpenNext runs
   everything in workerd node-compat, no Next edge runtime.
3. Add `@opennextjs/cloudflare` + `wrangler`. Create `open-next.config.ts` with
   **`buildCommand: "next build --webpack"`** (keeps `next-pwa`'s webpack-only SW plugin firing;
   turbopack would silently skip it).
4. Create `wrangler.jsonc`: `nodejs_compat`, assets binding for `public/` + `_next/static`, no
   incremental-cache binding (zero ISR), no IMAGES binding (passthrough loader). Set
   `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` + `NEXT_PUBLIC_AGENT_URL=https://api.fixo.ink`.
5. `wrangler dev` and verify.
6. **If OG font fetch fails** (`fetch(new URL('./_fonts/*.ttf', import.meta.url))` — workerd has no
   `file://` fetch): switch both `opengraph-image.tsx` files to build-time binary font imports
   (ArrayBuffer → `ImageResponse.fonts`). Fix once, applies to both.

**Gate:**

- Home + `/obd/[code]` SSG serve
- **Supabase middleware session refresh on deployed workerd** (login → `/chat`), cookie set-through
  — this rides on the Next 16 Proxy architecture (workers-sdk #13755), verify on real workerd not
  just `wrangler dev`
- `auth/callback` + `auth/confirm` redirect correctly
- **Both OG routes render a PNG with correct Geist font** (the one genuine runtime unknown)
- `public/sw.js` emitted, served with correct content-type, precache manifest references resolvable
  `/_next/static` paths; `/manifest.json` reachable

**Effort:** Half a day to one day. **Fallback:** if middleware/PWA on OpenNext proves unstable, keep
fixo-web on Vercel — it talks to `api.fixo.ink` over HTTP and is decoupled; leaving it on Vercel
blocks nothing else.

---

### Phase 3 — Fixo API + agent → Workers (mount into the existing worker)

**Goal:** Move the Fixo API/agent off Deno Deploy into the CF worker graph. Fixo runs in the same
Deno process as HMLS today (`index.ts:56-77`); PR #146 mounted only `createHmlsApp()`. Most of Fixo
already runs on workerd (Stripe, node:crypto, Supabase storage, Gemini via fetch, postgres-js — all
proven). Only two real jobs: the env swap and the ffmpeg stub.

**Steps:**

1. **Env swap** (mechanical, mirror PR #146's HMLS swap): `Deno.env.get('X') → env('X')` from
   `@hmls/shared/env` across ~11 files: `fixo/agent.ts`, `summarizer.ts`, `summarize.ts`,
   `lib/storage.ts`, `lib/stripe.ts`, `routes/fixo/{chat,sessions,billing}.ts`,
   `middleware/fixo/credits.ts`.
2. **Stub ffmpeg on workerd:** drop `extractVideoFramesTool` from `agent.ts:44` `allTools` (or
   `execute()` returns `toolResult({error:'video frame extraction not available'})`). This is the
   entire ffmpeg problem deferred — video isn't a shipped feature.
3. **Mount Fixo:** add `createFixoApp()` to `worker.ts`, replicate `index.ts:60-77` hostname
   dispatch (`host ∈ FIXO_HOSTS → fixoApp.fetch`, else `hmlsApp`) inside the existing `runWithEnv`
   scope. Re-add a **fail-soft** (per-request, not boot-time) `GOOGLE_API_KEY` check.
4. **Bundle-size gate:** `deno task build:worker`, read the printed gzipped size. Adding Gemini
   SDK + Fixo tools to the react-pdf/yoga/postgres/deepseek bundle may exceed 10 MB. **If over:**
   split Fixo into `fixo-worker.ts` (`createFixoApp` only) + a second wrangler config
   `name:"fixo-api"` reusing the same esbuild pipeline; accept the doubled DB client pair (small)
   rather than adding Hyperdrive. **If under:** keep one worker (shares the single `@hmls/agent/db`
   client pair — flat connections).
5. Secrets: `wrangler secret put GOOGLE_API_KEY SUPABASE_SERVICE_ROLE_KEY`; `FIXO_MEDIA_BUCKET` var.
   Confirm Fixo's Stripe webhook uses `constructEventAsync` (Web-crypto) not `constructEvent`.
6. `wrangler dev` against `fixo.localhost`.

**Gate:**

- session create → `/input` photo upload (Supabase signed-URL round-trip) → `/task` chat stream
  (Gemini SSE, up to 10 agent steps — confirm it stays under Workers CPU/wall limits on the paid
  plan with a realistic multi-photo session) → `/complete` report → MCP `/v1/diagnose`
- Stripe webhook signature verification works on workerd

**Steps 7 (cutover):** route `api.fixo.ink` to the Worker (custom domain, same-account zone from the
cross-cutting prerequisite), flip the CF DNS record off the `hmls-api.deno.dev` CNAME, deploy.
Decommission the Fixo half of Deno Deploy.

**Effort:** ~1 day.

---

### Phase 4 (deferred — only when video upload ships) — ffmpeg Cloudflare Container

**Goal:** Restore video-frame extraction. Off the critical path; do not build now.

**Steps:** Dockerfile (`node:22-slim` + `apt-get install -y ffmpeg` + ~30-line HTTP server exposing
`POST /frames?count=N` taking raw video bytes → `{frames:[base64,...]}`). Declare `containers` entry
in the fixo wrangler config (`class_name` + `image=Dockerfile` + `max_instances`) backed by a
Durable Object using the `@cloudflare/containers` `Container` helper. Rewrite
`extractVideoFrames.ts`: keep `getMedia()`/`uploadMedia()` (Supabase I/O stays in the Worker —
container needs **zero credentials**, pure bytes→bytes), replace only the ffmpeg+FS block with
`container.fetch(POST /frames, body=videoBytes)`. **No R2 needed** — `MAX_RAW_BYTES` is 37 MB
(`input.ts:35`), well under isolate memory; shuttle bytes over the binding.

**Effort:** +1 day.

---

### Phase 5 — Deploy wiring, secrets, teardown

Runs alongside Phases 1-3 (the deploy path must exist to verify each phase on `*.workers.dev`),
finalized last.

1. Create scoped `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, Workers Routes:Edit, Account:Read,
   Zone DNS:Edit for **both** zones) + `CLOUDFLARE_ACCOUNT_ID`; store in Infisical.
2. Pick Workers Builds per worker (recommended). **API workers build with Deno**
   (`esbuild + @deno/esbuild-plugin`), but Workers Builds' default image is Node/bun — prepend a
   pinned `curl -fsSL https://deno.land/install.sh | sh` to the build command, **or** run the bundle
   in GH Actions with `denoland/setup-deno@v2` (proven in `ci.yml:22`) and `wrangler deploy` the
   prebuilt `dist` (never commit dist — 9 MB, gitignored).
3. Secrets pipeline: Infisical→Cloudflare integration or `scripts/sync-cf-env.sh`
   (`wrangler secret bulk`), matrixed over hmls-api + fixo-api. Web `NEXT_PUBLIC_*` as build-env
   vars.
4. **No Supabase Auth change** — hostnames unchanged, same origins, new backend. Confirm gateway
   CORS lists live origins (`fixo-app.ts:30` already has fixo.ink + localhost; verify HMLS app CORS
   lists hmls.autos + Authorization + X-Shop-Id).
5. **Rollback window (~1 week):** disable the Deno Deploy GitHub integration and disconnect the repo
   from both Vercel projects so merges stop deploying, but keep the old `*.deno.dev`/`*.vercel.app`
   targets **alive** — the proxied CF record flips back in minutes.
6. **After stable:** delete Deno Deploy `hmls-api` + both Vercel projects; remove `deploy` blocks
   from `deno.json` + `apps/gateway/deno.json`; delete `apps/fixo-web/vercel.json` +
   `.vercelignore`; retire `scripts/sync-deno-env.sh` + the Infisical→Vercel integration.

**Effort:** ~2 days (excludes fixo-api entrypoint/build + container, budgeted in Phases 3/4).

---

### Risks & unknowns

- **OpenNext + Next 16 Proxy maturity (highest risk).** Support only lands at 16.2.6+ and the new
  Proxy/middleware architecture (workers-sdk #13755) is newly stabilized. **Mitigation:** Phase 1
  (hmls-web, no middleware) proves the path before fixo-web (middleware+PWA) commits. **Fallback:**
  if either web spike fails on workerd, keep that app on Vercel — both talk to the API over HTTP and
  are fully decoupled; leaving a web on Vercel blocks nothing.
- **OG font loading on workerd** (fixo-web): `fetch(import.meta.url)` for TTFs may fail (no
  `file://`). Fallback (binary import) is well understood but needs a run to confirm.
- **Combined API bundle size**: Gemini SDK + Fixo tools on top of react-pdf/yoga/postgres/deepseek
  may bust the 10 MB gzipped limit. Gated in Phase 3 step 4 (split to own worker if over).
- **Agent CPU budget**: a 10-step Gemini turn with vision inputs must stay under paid-plan Workers
  limits — needs a measured check, not an assumption.
- **DB connection ceiling** is Supavisor `max_client_conn`, not Postgres `max_connections`. Untuned
  `postgres()` (max=10, idle_timeout=0) × 2 clients × many warm isolates could saturate under a
  spike. **Cheap insurance, metrics-gated:** add `max:3, idle_timeout:20` to the two `postgres()`
  calls in `client.ts:62,71`. Not urgent for a single dogfood shop.
- **Transaction-pooler port**: confirm deployed `DATABASE_URL`/`TENANT_DATABASE_URL` secrets point
  at `:6543` (transaction mode, per `wrangler.jsonc`), not the stale `:5432` in CLAUDE.md. `:5432`
  (session pooler) has a much lower client ceiling — wrong tradeoff for worker fan-out.
- **fixo.ink NS propagation**: registrar nameserver change must complete before the fixo cutover or
  `api.fixo.ink` breaks.
- **Deno-in-Workers-Builds**: inline Deno install adds a moving dependency to every API deploy; pin
  the version or use GH Actions.
- **One CI token = wide blast radius**: scope to the two zones + Workers only, rotate via Infisical.

### What we are NOT changing

- **Database stays Supabase Postgres.** The DB layer already runs on workerd (verified in #146).
  OpenNext web workers add **zero** Postgres connections — both webs talk to the backend over HTTP
  and import only compile-time-erased DB _types_. No schema change, no client rewrite, no
  Hyperdrive.
- **Auth stays Supabase GoTrue.** Hostnames are unchanged through cutover, so Supabase Auth redirect
  URLs need no change. fixo-web's Supabase usage is auth-only (over HTTPS, not the Postgres pooler).
- **Fixo media stays on Supabase Storage** (bucket `fixo-media`, signed URLs). `lib/storage.ts` is
  already fetch-based and Workers-compatible. Not migrating to R2 — it buys nothing here except
  another moving part.
- **RLS model unchanged** (`withTenantScope` GUC + AsyncLocalStorage; admin bypass). Same C4 path
  already verified for streaming.
- **`workers/olp-worker`** already on CF — untouched.
