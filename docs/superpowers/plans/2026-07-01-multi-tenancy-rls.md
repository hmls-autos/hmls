# Multi-tenancy Phase 2: Postgres RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Postgres Row-Level-Security backstop under the existing app-layer tenant scoping, so
a *forgotten* app scope leaks no cross-shop data — the isolation guarantee HMLS needs as it grows
from two sites into a nationwide mechanic network (first external tenant ~1 month out).

**Architecture:** A new non-`BYPASSRLS` role (`tenant_app`) becomes the default `db` connection;
per-request shop context is set as a transaction-local GUC (`app.shop_id` / `app.customer_id`) via
an `AsyncLocalStorage`-bound short transaction, so the 399 existing `db.x` query sites change zero
lines. A separate `dbAdmin` (`service_role`, bypass) serves bootstrap/system/owner-all/public-token
paths. RLS ships **off** first (behavior-neutral), then flips on via a second, instantly-reversible
migration.

**Tech Stack:** Deno (gateway + agent, `@std` test, Hono), Drizzle ORM + postgres-js, Postgres
(Supabase), `node:async_hooks` AsyncLocalStorage, raw idempotent SQL migrations via
`scripts/db-apply.sh`.

## Global Constraints

- **Migrations applied via `scripts/db-apply.sh <env> <file>`, NEVER `db:migrate`** (the drizzle
  journal tracks ~2 of ~37 files; the `.sql` files are source of truth). Every migration MUST be
  idempotent.
- **`dev` Infisical env IS the prod Supabase DB.** Applying any migration to `dev` touches
  production → requires explicit user go-ahead (Tasks 5, 6, 8).
- **A LOCAL Supabase exists for testing** (`supabase start` → `scripts/db-local-reset.sh` →
  `scripts/dev-local.sh [api|web]`). Local DB is rebuilt from `schema.ts`, so raw SQL migrations are
  applied by hand: `psql "$LOCAL_DB_URL" -f <file>`. **Verify RLS locally (Task 7) before prod.**
- **Deno code:** double quotes, 2-space indent, 100-char lines (`deno fmt`).
- **Full local CI before any push:** `cd apps/hmls-web && bun run lint && bun run typecheck &&
  bun run test && bun run build`; `deno task check`; `cd apps/gateway && deno test` and
  `cd apps/agent && deno test`.
- **The two GUCs are mutually exclusive per request:** customer requests set ONLY `app.customer_id`
  (a customer sees own orders across shops); staff/owner-with-shop set ONLY `app.shop_id`. Setting
  both on a customer request would expose other customers' rows in that shop — do not.

## File Structure

- `packages/shared/src/db/client.ts` — **rewrite**. `createDbClient` now returns
  `{ db, dbAdmin, withTenantScope, withAdminScope }`; adds the ALS store, tx-routing proxy, and the
  scope helpers. Plus pure `pickScopeConfig`.
- `packages/shared/src/db/client_test.ts` — **create**. Unit tests for `pickScopeConfig`.
- `apps/agent/src/db/client.ts` — **modify**. Destructure the new factory return; re-export
  `dbAdmin`, `withTenantScope`, `withAdminScope`.
- `apps/gateway/src/middleware/with-tenant-tx.ts` — **create**. Hono middleware wrapping scoped CRUD
  handlers in a tenant transaction.
- `apps/gateway/src/routes/{admin,orders,mechanic,admin-mechanics}.ts` — **modify**. Mount
  `withTenantTx("shop")` after `requireShopContext`.
- `apps/gateway/src/routes/portal.ts` — **modify**. Mount `withTenantTx("customer")`.
- `apps/agent/src/common/convert-tools.ts` — **modify**. Wrap each tool's `execute` in the right
  scope (customer/shop → `withTenantScope`; owner-all → `withAdminScope`; no tenant ctx → passthrough
  for Fixo).
- `apps/gateway/src/middleware/shop-context.ts` — **modify**. Bootstrap reads → `dbAdmin`.
- `apps/gateway/src/routes/chat.ts` — **modify**. `resolveCustomer` identity reads → `dbAdmin`.
- `apps/gateway/src/routes/estimates.ts` + `orders.ts` (public PDF, ~line 594) — **modify**.
  Public shareToken/PDF reads → `dbAdmin`.
- `apps/agent/migrations/0038_tenant_app_role.sql` — **create**. Role + grants (RLS OFF).
- `apps/agent/migrations/0039_enable_rls.sql` + `0039_disable_rls.sql` — **create**. Policies +
  ENABLE/FORCE, and the rollback.
- `apps/agent/src/db/tenant_rls_test.ts` — **create**. L2 real-DB isolation test as `tenant_app`.

---

### Task 1: Core primitive — ALS proxy, `dbAdmin`, `withTenantScope`, `withAdminScope`

**Files:**
- Modify: `packages/shared/src/db/client.ts` (currently 37 lines — full rewrite)
- Create: `packages/shared/src/db/client_test.ts`
- Modify: `apps/agent/src/db/client.ts` (the sole consumer of `createDbClient`)

**Interfaces:**
- Produces:
  - `pickScopeConfig(ctx: { shopId?: string; customerId?: number }): { setting: "app.customer_id" |
    "app.shop_id"; value: string }` — pure; throws if neither is present (fail-closed).
  - `createDbClient<T>(schema: T): { db; dbAdmin; withTenantScope; withAdminScope }` where
    `withTenantScope<R>(ctx: { shopId?: string; customerId?: number }, fn: () => Promise<R>):
    Promise<R>` and `withAdminScope<R>(fn: () => Promise<R>): Promise<R>`.
  - Re-exported from `@hmls/agent/db`: `db`, `dbAdmin`, `withTenantScope`, `withAdminScope`,
    `schema`, and (via `./tenant.ts`) `OWNER_ALL_SHOPS`.

- [ ] **Step 1: Write the failing unit test for `pickScopeConfig`**

Create `packages/shared/src/db/client_test.ts`:

```ts
import { assertEquals, assertThrows } from "@std/assert";
import { pickScopeConfig } from "./client.ts";

Deno.test("pickScopeConfig: customer identity wins over shop", () => {
  assertEquals(pickScopeConfig({ customerId: 42, shopId: "shop-uuid" }), {
    setting: "app.customer_id",
    value: "42",
  });
});

Deno.test("pickScopeConfig: concrete shop scopes by shop", () => {
  assertEquals(pickScopeConfig({ shopId: "shop-uuid" }), {
    setting: "app.shop_id",
    value: "shop-uuid",
  });
});

Deno.test("pickScopeConfig: empty context is fail-closed", () => {
  assertThrows(() => pickScopeConfig({}), Error, "fail-closed");
});
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `cd packages/shared && deno test src/db/client_test.ts`
Expected: FAIL — `pickScopeConfig` is not exported.

- [ ] **Step 3: Rewrite `packages/shared/src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";

// ALS carries the current DB executor (a scoped transaction, or the admin
// client) for the duration of a request/tool unit. When set, the `db` proxy
// routes to it; when unset, `db` uses the base tenant pool — which, under RLS
// with no GUC set, denies tenant-table access (fail-closed).
// deno-lint-ignore no-explicit-any
type Executor = any;
const txStore = new AsyncLocalStorage<{ executor: Executor }>();

/** Decide which GUC a scoped transaction must set. Pure — unit tested.
 *  Customer identity wins (a customer sees own rows across shops); otherwise a
 *  concrete shopId scopes to that shop. Owner-all is NOT handled here — callers
 *  route owner-wide reads through withAdminScope. */
export function pickScopeConfig(
  ctx: { shopId?: string; customerId?: number },
): { setting: "app.customer_id" | "app.shop_id"; value: string } {
  if (ctx.customerId != null) {
    return { setting: "app.customer_id", value: String(ctx.customerId) };
  }
  if (ctx.shopId) return { setting: "app.shop_id", value: ctx.shopId };
  throw new Error("withTenantScope: no customerId or shopId in context (fail-closed)");
}

/**
 * Create the tenant + admin DB clients and the scope helpers.
 * Each app passes its own schema for type-safe queries.
 */
export function createDbClient<T extends Record<string, unknown>>(schema: T) {
  let _tenant: ReturnType<typeof drizzle<T>> | null = null;
  let _admin: ReturnType<typeof drizzle<T>> | null = null;

  function tenantDb() {
    if (!_tenant) {
      // Prefer the restricted role; fall back to service_role until the role +
      // TENANT_DATABASE_URL are provisioned (so rollout step 1 is behavior-neutral).
      const url = Deno.env.get("TENANT_DATABASE_URL") ?? Deno.env.get("DATABASE_URL");
      if (!url) throw new Error("TENANT_DATABASE_URL/DATABASE_URL environment variable is required");
      // deno-lint-ignore no-explicit-any
      _tenant = drizzle(postgres(url) as any, { schema });
    }
    return _tenant;
  }
  function adminDb() {
    if (!_admin) {
      const url = Deno.env.get("DATABASE_URL");
      if (!url) throw new Error("DATABASE_URL environment variable is required");
      // deno-lint-ignore no-explicit-any
      _admin = drizzle(postgres(url) as any, { schema });
    }
    return _admin;
  }

  function proxy(pick: () => ReturnType<typeof drizzle<T>>) {
    return new Proxy({} as ReturnType<typeof drizzle<T>>, {
      get(_t, prop) {
        const target = pick();
        const value = target[prop as keyof typeof target];
        // deno-lint-ignore no-explicit-any
        return typeof value === "function" ? (value as any).bind(target) : value;
      },
    });
  }

  // Default: ALS executor wins; else base tenant pool (fail-closed under RLS).
  const db = proxy(() => (txStore.getStore()?.executor as ReturnType<typeof drizzle<T>>) ?? tenantDb());
  // Admin: ALWAYS service_role, ignoring ALS. Bootstrap/system/owner-all/public-token.
  const dbAdmin = proxy(() => adminDb());

  /** Run `fn` inside a short transaction with the tenant GUC set (is_local,
   *  reset at COMMIT). All `db.x` inside `fn` transparently use this tx. */
  async function withTenantScope<R>(
    ctx: { shopId?: string; customerId?: number },
    fn: () => Promise<R>,
  ): Promise<R> {
    const { setting, value } = pickScopeConfig(ctx);
    return await tenantDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config(${setting}, ${value}, true)`);
      return await txStore.run({ executor: tx }, fn);
    });
  }

  /** Run `fn` bound to the admin (service_role) client — cross-tenant (owner-all)
   *  and explicitly-privileged/bootstrap paths. No RLS. */
  async function withAdminScope<R>(fn: () => Promise<R>): Promise<R> {
    return await txStore.run({ executor: adminDb() }, fn);
  }

  return { db, dbAdmin, withTenantScope, withAdminScope };
}
```

- [ ] **Step 4: Run the unit test; confirm green**

Run: `cd packages/shared && deno test src/db/client_test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update the consumer `apps/agent/src/db/client.ts`**

```ts
import { createDbClient } from "@hmls/shared/db";
import * as schema from "@hmls/shared/db/schema";

export const { db, dbAdmin, withTenantScope, withAdminScope } = createDbClient(schema);
export { schema };
export type { FixoMedia, OrderItem } from "@hmls/shared/db/schema";
export * from "./tenant.ts";
```

- [ ] **Step 6: Typecheck the whole workspace**

Run: `deno task check`
Expected: PASS (no consumer of `db` breaks — the proxy shape is unchanged; only new exports added).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/db/client.ts packages/shared/src/db/client_test.ts \
        apps/agent/src/db/client.ts
git commit -m "feat(db): tenant/admin client split + ALS tenant-scope helpers (RLS scaffolding)"
```

---

### Task 2: Gateway CRUD middleware — `withTenantTx`

**Files:**
- Create: `apps/gateway/src/middleware/with-tenant-tx.ts`
- Modify: `apps/gateway/src/routes/admin.ts` (after `admin.use("*", requireShopContext)` — line 21)
- Modify: `apps/gateway/src/routes/orders.ts` (after line 73)
- Modify: `apps/gateway/src/routes/mechanic.ts` (after line 25)
- Modify: `apps/gateway/src/routes/admin-mechanics.ts` (after line 79)
- Modify: `apps/gateway/src/routes/portal.ts` (after line 24)

**Interfaces:**
- Consumes: `withTenantScope`, `withAdminScope` from `@hmls/agent/db`; `OWNER_ALL_SHOPS` from
  `./shop-context.ts`; `c.get("shopId")` (set by requireShopContext), `c.get("customerId")` (set by
  requireAuth on portal).
- Produces: `withTenantTx(mode: "shop" | "customer")` — Hono middleware.

- [ ] **Step 1: Create the middleware**

```ts
// apps/gateway/src/middleware/with-tenant-tx.ts
import { createMiddleware } from "hono/factory";
import { withAdminScope, withTenantScope } from "@hmls/agent/db";
import { OWNER_ALL_SHOPS } from "./shop-context.ts";

/**
 * Wrap a scoped route handler so every `db` query inside it runs in a tenant
 * transaction with the correct RLS GUC set. Mount AFTER requireShopContext
 * (shop mode) / requireAuth (customer mode). NOT for streaming chat routes —
 * those wrap per-tool instead (see convert-tools.ts).
 *   - "shop": staff/owner routers. Owner with no shop → admin (cross-shop read).
 *   - "customer": portal. Scopes by the authed customerId.
 */
export function withTenantTx(mode: "shop" | "customer") {
  return createMiddleware(async (c, next) => {
    if (mode === "customer") {
      const customerId = c.get("customerId" as never) as number;
      return await withTenantScope({ customerId }, next);
    }
    const shopId = c.get("shopId" as never) as string;
    if (shopId === OWNER_ALL_SHOPS) return await withAdminScope(next);
    return await withTenantScope({ shopId }, next);
  });
}
```

- [ ] **Step 2: Mount on the four staff routers**

In each of `admin.ts`, `orders.ts`, `mechanic.ts`, `admin-mechanics.ts`, add the import and mount
directly after the existing `requireShopContext` line. Example for `admin.ts` (line 21):

```ts
import { withTenantTx } from "../middleware/with-tenant-tx.ts";
// ...
admin.use("*", requireShopContext);
admin.use("*", withTenantTx("shop"));
```

Repeat verbatim (adjusting the router variable: `orders`, `mechanic`, `adminMechanics`) in the other
three files, each right after their `requireShopContext` mount.

- [ ] **Step 3: Mount on portal (customer mode)**

In `portal.ts` after line 24:

```ts
import { withTenantTx } from "../middleware/with-tenant-tx.ts";
// ...
portal.use("*", requireAuth);
portal.use("*", requireShopContext);
portal.use("*", withTenantTx("customer"));
```

- [ ] **Step 4: Typecheck + run the gateway test suite (no-regression check)**

Run: `deno task check && cd apps/gateway && deno test`
Expected: PASS. With `TENANT_DATABASE_URL` unset and RLS still off, `withTenantScope` just opens a
harmless transaction that sets a GUC no policy reads — behavior is identical to today.

- [ ] **Step 5: Commit**

```bash
git add apps/gateway/src/middleware/with-tenant-tx.ts apps/gateway/src/routes/admin.ts \
        apps/gateway/src/routes/orders.ts apps/gateway/src/routes/mechanic.ts \
        apps/gateway/src/routes/admin-mechanics.ts apps/gateway/src/routes/portal.ts
git commit -m "feat(gateway): wrap scoped CRUD routes in tenant transactions"
```

---

### Task 3: Wrap agent tools in the tenant scope

**Files:**
- Modify: `apps/agent/src/common/convert-tools.ts` (the `convertTools` execute closure, lines 31-37)

**Interfaces:**
- Consumes: `withTenantScope`, `withAdminScope` from `../db/client.ts`; `OWNER_ALL_SHOPS` from
  `../db/tenant.ts`; the existing `ToolContext` (`{ customerId?, shopId?, fixoSessionId?, ... }`).
- Produces: no new exports — behavior change to `convertTools`.

- [ ] **Step 1: Wrap `execute` by scope**

Replace the `convertTools` loop body (lines 31-37) with:

```ts
import { withAdminScope, withTenantScope } from "../db/client.ts";
import { OWNER_ALL_SHOPS } from "../db/tenant.ts";
// ... inside convertTools, per tool:
    result[t.name] = {
      description: t.description,
      inputSchema: t.schema,
      execute: (input: unknown) => {
        // Owner viewing all shops → cross-shop read on the admin connection.
        if (ctx?.shopId === OWNER_ALL_SHOPS) {
          return withAdminScope(() => t.execute(input, ctx));
        }
        // A concrete shop (staff) or a customer → RLS-scoped transaction.
        if (ctx?.customerId != null || ctx?.shopId) {
          return withTenantScope(
            { shopId: ctx.shopId, customerId: ctx.customerId },
            () => t.execute(input, ctx),
          );
        }
        // No tenant context (e.g. Fixo tools) → run unscoped on the base pool.
        // Fixo tables are not RLS'd; tenant_app has grants on them.
        return t.execute(input, ctx);
      },
    };
```

- [ ] **Step 2: Typecheck + agent tests (no-regression)**

Run: `deno task check && cd apps/agent && deno test`
Expected: PASS. RLS is still off, so scoping is behavior-neutral; Fixo tools take the passthrough
branch and are unaffected.

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/common/convert-tools.ts
git commit -m "feat(agent): run tenant tools inside RLS-scoped transactions"
```

---

### Task 4: Route bootstrap + public paths to `dbAdmin`

Under fail-closed RLS these paths must NOT be tenant-scoped: they either run before a shop is known
(identity resolution) or authenticate by a capability token, not a shop.

**Files:**
- Modify: `apps/gateway/src/middleware/shop-context.ts` (the `db` reads at lines 76-105)
- Modify: `apps/gateway/src/routes/chat.ts` (`resolveCustomer`, the `db` reads ~lines 23-90)
- Modify: `apps/gateway/src/routes/estimates.ts` (public order read, ~line 33)
- Modify: `apps/gateway/src/routes/orders.ts` (public/no-token PDF route, ~line 594+)

**Interfaces:**
- Consumes: `dbAdmin` from `@hmls/agent/db`.

- [ ] **Step 1: `shop-context.ts` → `dbAdmin`**

Import `dbAdmin` and replace the three `db` reads inside `requireShopContext` (providers lookup
line 76-77, customers `authUserId` lookup 83-85, email-fallback select 89-93, and the self-heal
`update` 98-101, plus `loadValidShopIds` at 47-50) with `dbAdmin`. These resolve *who* the caller is
before a shop context exists — they cannot be shop-scoped.

```ts
import { dbAdmin, schema } from "@hmls/agent/db";
// then s/\bdb\./dbAdmin./ within requireShopContext and loadValidShopIds
```

- [ ] **Step 2: `chat.ts` `resolveCustomer` → `dbAdmin`**

`resolveCustomer` resolves/creates the customer by authUserId/email BEFORE the agent has a shop
context. Change its `db` references (the two selects, the self-heal update, and the insert) to
`dbAdmin`. Import `dbAdmin` from `@hmls/agent/db`.

- [ ] **Step 3: Public shareToken/PDF reads → `dbAdmin`**

- `estimates.ts` (~line 33): the public PDF route reads an order by `shareToken` with no
  `requireShopContext`. A shareToken is a capability, not a shop scope. Switch that `db.select()
  .from(schema.orders)` to `dbAdmin` (keep the existing post-fetch ownership/token check).
- `orders.ts` (~line 594+): the no-token admin PDF route mounted under `/api/admin/orders`. Confirm
  whether it runs under `withTenantTx` (it is under `requireShopContext`, so it does). If it renders
  cross-shop for an owner via token, switch its order read to `dbAdmin`; otherwise leave it scoped.
  Decide by reading the handler.

- [ ] **Step 4: Audit customer-facing provider reads**

A customer request sets only `app.customer_id`, so a direct read of `providers` (e.g. the assigned
mechanic's name on a customer's order-detail) is denied under RLS. Grep the portal + customer chat
paths:

Run: `grep -rn "schema.providers" apps/gateway/src/routes/portal.ts apps/agent/src/hmls`
For any hit that serves a customer, read that one field via `dbAdmin` (or accept it's staff-only).
If there are no customer-facing provider reads, note it and move on.

- [ ] **Step 5: Typecheck + full gateway/agent tests**

Run: `deno task check && cd apps/gateway && deno test && cd ../agent && deno test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/gateway/src/middleware/shop-context.ts apps/gateway/src/routes/chat.ts \
        apps/gateway/src/routes/estimates.ts apps/gateway/src/routes/orders.ts
git commit -m "feat(gateway): route bootstrap + public-token reads to dbAdmin (RLS-safe)"
```

---

### Task 5: Migration 0038 — `tenant_app` role + grants (RLS OFF)

**Files:**
- Create: `apps/agent/migrations/0038_tenant_app_role.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0038: create the non-BYPASSRLS application role used to enforce RLS.
-- Idempotent. Does NOT enable RLS (that is 0039). With no policies yet,
-- tenant_app can read everything, so shipping the code split (Tasks 1-4) is
-- behavior-neutral until 0039 flips RLS on.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_app') THEN
    CREATE ROLE tenant_app LOGIN NOINHERIT;
  END IF;
END $$;

-- Password is set out-of-band (never in the tracked migration):
--   ALTER ROLE tenant_app WITH PASSWORD '<from-secret-manager>';
-- TENANT_DATABASE_URL then connects as this role.

GRANT USAGE ON SCHEMA public TO tenant_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenant_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tenant_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tenant_app;
-- Future objects created by the migration owner:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tenant_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tenant_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO tenant_app;
```

- [ ] **Step 2: Apply to LOCAL Supabase + verify the role exists**

Ensure local Supabase is running (`supabase start`; if schema is stale, `scripts/db-local-reset.sh`).

Run: `psql "$LOCAL_DB_URL" -f apps/agent/migrations/0038_tenant_app_role.sql`
Then: `psql "$LOCAL_DB_URL" -c "\du tenant_app"` and
`psql "$LOCAL_DB_URL" -c "ALTER ROLE tenant_app WITH PASSWORD 'localtest';"`
Expected: role `tenant_app` listed (not BYPASSRLS, not superuser).

- [ ] **Step 3: Commit (file only — prod apply is gated in Task 8)**

```bash
git add apps/agent/migrations/0038_tenant_app_role.sql
git commit -m "feat(db): migration 0038 — tenant_app role + grants (RLS off)"
```

---

### Task 6: Migration 0039 — policies + ENABLE RLS + rollback

**Files:**
- Create: `apps/agent/migrations/0039_enable_rls.sql`
- Create: `apps/agent/migrations/0039_disable_rls.sql` (rollback)

- [ ] **Step 1: Write the enable migration**

```sql
-- 0039: enable RLS on the 7 tenant tables with policies keyed on transaction-
-- local GUCs app.shop_id (staff) / app.customer_id (customer). Idempotent:
-- policies dropped-if-exists then recreated; ENABLE/FORCE are idempotent.
-- ROLLBACK: apply 0039_disable_rls.sql (reverts to app-layer-only in seconds).
-- NOTE: service_role is BYPASSRLS, so dbAdmin still sees everything by design.

-- orders: staff sees own shop; customer sees own orders across any shop.
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_tenant ON orders;
CREATE POLICY orders_tenant ON orders FOR ALL
  USING (
    shop_id = nullif(current_setting('app.shop_id', true), '')::uuid
    OR customer_id = nullif(current_setting('app.customer_id', true), '')::int
  )
  WITH CHECK (
    shop_id = nullif(current_setting('app.shop_id', true), '')::uuid
    OR customer_id = nullif(current_setting('app.customer_id', true), '')::int
  );

-- customers: staff sees own-shop customers; a customer sees own row.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_tenant ON customers;
CREATE POLICY customers_tenant ON customers FOR ALL
  USING (
    shop_id = nullif(current_setting('app.shop_id', true), '')::uuid
    OR id = nullif(current_setting('app.customer_id', true), '')::int
  )
  WITH CHECK (
    shop_id = nullif(current_setting('app.shop_id', true), '')::uuid
    OR id = nullif(current_setting('app.customer_id', true), '')::int
  );

-- providers: shop-scoped only.
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS providers_tenant ON providers;
CREATE POLICY providers_tenant ON providers FOR ALL
  USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);

-- order_intake / order_events → orders (parent visibility; inner select is
-- itself RLS-filtered by the orders policy).
ALTER TABLE order_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_intake FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_intake_tenant ON order_intake;
CREATE POLICY order_intake_tenant ON order_intake FOR ALL
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_intake.order_id))
  WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_intake.order_id));

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_events_tenant ON order_events;
CREATE POLICY order_events_tenant ON order_events FOR ALL
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_events.order_id))
  WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_events.order_id));

-- provider_availability / provider_schedule_overrides → providers.
ALTER TABLE provider_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_availability FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_availability_tenant ON provider_availability;
CREATE POLICY provider_availability_tenant ON provider_availability FOR ALL
  USING (EXISTS (SELECT 1 FROM providers p WHERE p.id = provider_availability.provider_id))
  WITH CHECK (EXISTS (SELECT 1 FROM providers p WHERE p.id = provider_availability.provider_id));

ALTER TABLE provider_schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_schedule_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_schedule_overrides_tenant ON provider_schedule_overrides;
CREATE POLICY provider_schedule_overrides_tenant ON provider_schedule_overrides FOR ALL
  USING (EXISTS (SELECT 1 FROM providers p WHERE p.id = provider_schedule_overrides.provider_id))
  WITH CHECK (EXISTS (SELECT 1 FROM providers p WHERE p.id = provider_schedule_overrides.provider_id));
```

- [ ] **Step 2: Write the rollback**

Create `apps/agent/migrations/0039_disable_rls.sql`:

```sql
-- Rollback for 0039: revert to app-layer-only isolation instantly. tenant_app
-- keeps its grants, so the app keeps working with RLS off.
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE providers DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_intake DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE provider_availability DISABLE ROW LEVEL SECURITY;
ALTER TABLE provider_schedule_overrides DISABLE ROW LEVEL SECURITY;
```

- [ ] **Step 3: Apply to LOCAL + smoke-check policies exist**

Run: `psql "$LOCAL_DB_URL" -f apps/agent/migrations/0039_enable_rls.sql`
Then: `psql "$LOCAL_DB_URL" -c "SELECT tablename FROM pg_policies WHERE policyname LIKE '%_tenant' ORDER BY 1;"`
Expected: 7 rows (orders, customers, providers, order_intake, order_events, provider_availability,
provider_schedule_overrides).

- [ ] **Step 4: Commit (files only — prod apply gated in Task 8)**

```bash
git add apps/agent/migrations/0039_enable_rls.sql apps/agent/migrations/0039_disable_rls.sql
git commit -m "feat(db): migration 0039 — enable RLS + tenant policies (+ rollback)"
```

---

### Task 7: L2 isolation proof — read as `tenant_app` with GUCs

This is the proof RLS works independently of app code. Runs against LOCAL Supabase (0038 + 0039
applied, `tenant_app` password set to `localtest`, `LOCAL_TENANT_DB_URL` pointing at it).

**Files:**
- Create: `apps/agent/src/db/tenant_rls_test.ts`

**Interfaces:**
- Consumes: `LOCAL_TENANT_DB_URL` env (a tenant_app connection string); `DATABASE_URL` (service_role,
  to seed fixtures). Test is skipped when either is absent.

- [ ] **Step 1: Write the isolation test**

```ts
// L3 — proves Postgres RLS blocks cross-tenant access for the tenant_app role.
// Skips unless BOTH a service_role DATABASE_URL (to seed) and a tenant_app
// connection (LOCAL_TENANT_DB_URL) are present. Run locally after applying
// migrations 0038 + 0039.
import { assertEquals } from "@std/assert";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { db, schema } from "./client.ts";
import { eq } from "drizzle-orm";

const SEED_URL = Deno.env.get("DATABASE_URL");
const TENANT_URL = Deno.env.get("LOCAL_TENANT_DB_URL");
const MARK = "[tenant-rls-l3]";

Deno.test({
  name: "RLS: tenant_app sees only its shop; blocks cross-tenant read/write",
  ignore: !SEED_URL || !TENANT_URL,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // Seed two shops + orders as service_role (bypass).
    const [a] = await db.insert(schema.shops).values({
      name: `${MARK} A`, slug: `${MARK}-a-${crypto.randomUUID()}`,
    }).returning();
    const [b] = await db.insert(schema.shops).values({
      name: `${MARK} B`, slug: `${MARK}-b-${crypto.randomUUID()}`,
    }).returning();
    const [ca] = await db.insert(schema.customers).values({ name: `${MARK} ca`, shopId: a.id }).returning();
    const [cb] = await db.insert(schema.customers).values({ name: `${MARK} cb`, shopId: b.id }).returning();
    const [oa] = await db.insert(schema.orders).values({
      shopId: a.id, customerId: ca.id, shareToken: `${MARK}-oa-${crypto.randomUUID()}`,
    }).returning();
    const [ob] = await db.insert(schema.orders).values({
      shopId: b.id, customerId: cb.id, shareToken: `${MARK}-ob-${crypto.randomUUID()}`,
    }).returning();

    // deno-lint-ignore no-explicit-any
    const tenant = drizzle(postgres(TENANT_URL!) as any, { schema });
    try {
      // Staff of shop A: sees oa, not ob.
      await tenant.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.shop_id', ${a.id}, true)`);
        const rows = await tx.select().from(schema.orders);
        assertEquals(rows.some((o) => o.id === oa.id), true);
        assertEquals(rows.some((o) => o.id === ob.id), false); // cross-tenant DENIED
        // Cross-tenant UPDATE affects 0 rows.
        const upd = await tx.update(schema.orders).set({ notes: "x" })
          .where(eq(schema.orders.id, ob.id)).returning();
        assertEquals(upd.length, 0);
      });

      // Customer cb: sees own order ob across shops, not oa.
      await tenant.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.customer_id', ${String(cb.id)}, true)`);
        const rows = await tx.select().from(schema.orders);
        assertEquals(rows.some((o) => o.id === ob.id), true);
        assertEquals(rows.some((o) => o.id === oa.id), false);
      });

      // No GUC set → fail-closed: zero tenant rows.
      await tenant.transaction(async (tx) => {
        const rows = await tx.select().from(schema.orders);
        assertEquals(rows.some((o) => o.id === oa.id || o.id === ob.id), false);
      });
    } finally {
      await tenant.$client.end();
      // Cleanup as service_role.
      await db.delete(schema.orders).where(eq(schema.orders.id, oa.id));
      await db.delete(schema.orders).where(eq(schema.orders.id, ob.id));
      await db.delete(schema.customers).where(eq(schema.customers.id, ca.id));
      await db.delete(schema.customers).where(eq(schema.customers.id, cb.id));
      await db.delete(schema.shops).where(eq(schema.shops.id, a.id));
      await db.delete(schema.shops).where(eq(schema.shops.id, b.id));
    }
  },
});
```

- [ ] **Step 2: Run it against LOCAL (with the tenant_app connection)**

Run: `cd apps/agent && LOCAL_TENANT_DB_URL="postgresql://tenant_app:localtest@127.0.0.1:54322/postgres" deno test src/db/tenant_rls_test.ts`
Expected: PASS — proves cross-tenant reads/writes are DB-blocked and the no-GUC case is fail-closed.
(If it FAILS on the cross-tenant assertions, a policy is wrong — STOP and fix 0039 before prod.)

- [ ] **Step 3: Confirm nested transactions still work (create_order path)**

The order-creation tool opens `db.transaction` (order.ts:795) *inside* the tool's `withTenantScope`
tx → a savepoint. Run the agent order tests locally against the RLS-enabled local DB with a seeded
shop context to confirm inserts + child-row writes succeed under RLS.

Run: `cd apps/agent && deno test src/common/tools/` (and any order-creation integration test)
Expected: PASS. If a WITH CHECK violation appears, the just-inserted parent must be visible to the
child insert under the same GUC — verify the tool sets the same shop/customer scope for the whole
transaction.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/db/tenant_rls_test.ts
git commit -m "test(db): L3 RLS isolation proof as tenant_app"
```

---

### Task 8: Full CI + staged prod rollout (GATED — explicit user go-ahead)

- [ ] **Step 1: Full local CI**

```bash
cd apps/hmls-web && bun run lint && bun run typecheck && bun run test && bun run build
cd ../.. && deno task check && deno task lint && deno task fmt:check
cd apps/gateway && deno test && cd ../agent && deno test
```
Expected: all green.

- [ ] **Step 2: FEASIBILITY GATE — Supabase pooler + custom role login (verify before prod)**

Confirm the Supavisor pooler authenticates `tenant_app` via the `tenant_app.<project-ref>` username
format. Test with a throwaway `psql` against the pooler host using a tenant_app connection string.
- If it connects: `TENANT_DATABASE_URL` uses the pooler (same host as `DATABASE_URL`, tenant_app
  creds).
- If REJECTED: fallbacks in order — (a) point `TENANT_DATABASE_URL` at the **direct** (non-pooler)
  Supabase connection for the tenant pool; (b) last resort, single-connection `SET LOCAL ROLE
  tenant_app` per shop-tx (degrades default to fail-open — must be flagged if taken).
  **STOP and report to the user which path was taken.**

- [ ] **Step 3: Merge code (Tasks 1-7) to main → auto-deploys with RLS still OFF**

Ship the PR. Because `TENANT_DATABASE_URL` is not yet set in prod and RLS is off, prod behavior is
unchanged — this validates the code-path split in production at zero isolation risk.

- [ ] **Step 4: Apply 0038 to prod + provision tenant_app secret (USER GO-AHEAD)**

```bash
scripts/db-apply.sh dev apps/agent/migrations/0038_tenant_app_role.sql
# set the password out-of-band, then store the connection string:
#   ALTER ROLE tenant_app WITH PASSWORD '<generated>';
# add TENANT_DATABASE_URL to Infisical (dev) and push to Deno Deploy:
scripts/sync-deno-env.sh dev   # or: deno deploy env add TENANT_DATABASE_URL <url> --app hmls-api --org spinsirr --secret
```
Verify: gateway boots, `SELECT 1` works as tenant_app, app still fully functional (RLS off → reads
everything). This flips the default `db` to the restricted role while it can still read everything.

- [ ] **Step 5: Apply 0039 to prod — flip RLS ON (USER GO-AHEAD; rollback ready)**

```bash
scripts/db-apply.sh dev apps/agent/migrations/0039_enable_rls.sql
```
Immediately smoke-test in the running app: an admin sees only their shop's orders; a customer sees
their own; owner switcher spans shops. Watch logs for RLS-denied (fail-closed) errors on any missed
path.
**Rollback lever if anything breaks:** `scripts/db-apply.sh dev apps/agent/migrations/0039_disable_rls.sql`
→ back to app-layer-only in seconds, no code change.

- [ ] **Step 6: Update memory**

Record in `project_multi_tenancy.md`: Phase 2 RLS landed — tenant_app role, GUC-per-tx model, 7
tables under RLS, rollback via 0039_disable_rls. Note the pooler-role path actually taken (Step 2).

---

## Self-Review

**Spec coverage:**
- Roles + connection topology (spec §1) → Tasks 1, 4, 5.
- GUC + ALS threading (spec §2) → Task 1.
- Wrap points ~30-50 (spec §3) → Tasks 2 (CRUD), 3 (tools), 4 (bootstrap→dbAdmin).
- Policies, 7 tables (spec §4) → Task 6.
- Rollout staged + reversible (spec §5) → Tasks 5, 6, 8.
- Testing: unit + L2/L3 real-DB (spec §6) → Tasks 1, 7.
- Feasibility gate (spec §1 ⚠) → Task 8 Step 2.
- Customer-vs-shop GUC mutual exclusivity (spec Global Constraint) → Task 1 `pickScopeConfig`
  (customer wins) + Task 3 wrapper.
- Deferred (Phase 2 external customer rows) → out of scope, unchanged.

**Placeholder scan:** none — all steps carry runnable code/commands. The two acknowledged decisions
(orders.ts:594 PDF scope; customer-facing provider reads) are explicit *audit* steps in Task 4 with
a decision rule, not deferred TODOs.

**Type consistency:** `pickScopeConfig`, `withTenantScope(ctx, fn)`, `withAdminScope(fn)`,
`dbAdmin`, `db`, `OWNER_ALL_SHOPS`, `withTenantTx(mode)` used identically across Tasks 1-3. GUC
names `app.shop_id` / `app.customer_id` identical across client.ts, middleware, and 0039.

## Known ponytail ceilings (noted, not fixed)

- **Tool-level transaction span:** wrapping a whole tool `execute` in `withTenantScope` holds a
  connection for the tool's full duration, incl. any external call it makes (e.g. create_order's
  ~5s geocode). Fine at dogfood/N=2 scale. Upgrade path: move external calls outside the tx when
  pool pressure appears. `// ponytail: tool-scoped tx; split out external calls if pool contends`
- **Child-policy EXISTS subquery per row:** O(rows) parent lookups. Fine at current volume; add a
  denormalized `shop_id` to child tables if it shows up in query plans.
