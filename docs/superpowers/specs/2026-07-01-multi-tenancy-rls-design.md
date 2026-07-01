# Multi-tenancy Phase 2: Postgres RLS — Design Spec

**Date:** 2026-07-01
**Status:** Design — approved forks locked; pending user spec review → writing-plans
**Predecessors:** `2026-06-17-multi-tenancy-design.md` (Phase 1, app-level scoping, LANDED PR #99),
`2026-06-29-multitenancy-area-shop-bridge.md` (coverage flag + region↔shop bridge + per-query
guard, LANDED).

## Goal

HMLS is being built into a nationwide network of mechanic shops (two sites today: San Jose +
Orange County). Tenant isolation must survive that growth and the first external paying tenant
(~1 month out). Phase 1 scoped every query at the **application layer** (399 tenant-table query
sites, all carrying a `shopId`/`customerId`/`shareToken` predicate; a CI guard test enforces it).
This spec adds the **database-layer backstop**: Postgres Row-Level Security so a *forgotten* app
scope — the exact failure the guard test can miss — leaks nothing.

**Non-goal (explicitly deferred to a later phase):** per-tenant customer rows / an external-tenant
`customer → shop` entry model. Today a customer reads their own orders across any shop; the RLS
policies below preserve that on purpose (the `app.customer_id` clause). Revisit when a genuinely
external tenant onboards.

## Why RLS is not optional here

The gateway talks to Supabase over a single **`service_role`** connection
(`packages/shared/src/db/client.ts`). `service_role` is `BYPASSRLS` — naive RLS policies do
nothing against it. Real DB-level isolation therefore requires a **dedicated non-`BYPASSRLS`
role** plus a mechanism to put per-request tenant context onto the connection. Both are designed
below.

## Locked design decisions (from brainstorming)

1. **Context mechanism — AsyncLocalStorage + short transactions.** Per-request shop context is
   bound in an `AsyncLocalStorage` store; each DB-access unit opens a *short* transaction that sets
   the tenant GUC as its first statement. The shared `db` proxy auto-routes to the ALS-bound
   transaction, so the 399 existing `db.x` query sites change **zero** lines. Connections are held
   only for a unit's DB work — never across a streaming LLM turn. (Rejected: one big
   per-request transaction — would pin a connection across 30s+ chat streams,
   idle-in-transaction, pool exhaustion. Rejected: per-request session-`SET` connection — leak
   risk on a shared pooler.)

2. **Fail-closed default.** The default `db` connection uses the new restricted role. Any query to
   an RLS table *not* wrapped in a shop-transaction is denied by the DB (0 rows / error), not
   silently bypassed. This is the only variant that actually delivers the defense-in-depth the
   deadline demands — a fail-open default would run a forgotten scope on a bypass connection and
   leak, which is precisely the failure RLS exists to catch.

3. **Table scope — full tenant set (7 tables).**
   - Direct `shop_id`: `orders`, `customers`, `providers`.
   - Child tables (no own `shop_id`, scoped by join-to-parent): `order_intake`, `order_events`
     (→ `orders`), `provider_availability`, `provider_schedule_overrides` (→ `providers`).
   - `pricing_config` has no `shop_id` (global; per-shop labor rate lives on `shops.hourly_rate`)
     → **not** RLS'd. `shops` is the tenant registry, not tenant-owned → **not** RLS'd (readable).

## Architecture

### 1. Roles + connection topology

Two physical connections from the gateway:

| Export | Role | BYPASSRLS | Used for |
| --- | --- | --- | --- |
| `db` (default; retargeted) | **new `tenant_app`** (LOGIN) | no | ALL tenant-data reads/writes. Subject to RLS on the 7 tables. |
| `dbAdmin` (new export; = today's connection) | `service_role` | yes | Bootstrap/system: `requireShopContext` resolving user→shop, Stripe webhook, `owner` all-shops reads, migrations, the DB-resident `handle_new_user` trigger. |

- `tenant_app` receives full grants on **non-tenant** tables (`shops`, `olp_*`, `pricing_config`,
  `fixo_*`, `obd_codes`, `user_profiles`, `vehicles`, `credit_ledger`, `promo_*`, `funnel_events`)
  with **no RLS** → Fixo and every other subsystem that shares the `db` client keep working.
  Fail-closed applies *only* to the 7 RLS tables.
- `ENABLE` + `FORCE ROW LEVEL SECURITY` on the 7 tables (`FORCE` is belt-and-suspenders so even a
  future table-owner connection is subject).

**Feasibility gate (plan step #1, before anything else):** confirm the Supabase pooler
(Supavisor) authenticates a custom login role via the `tenant_app.<project-ref>` username format.
If it does not, fallbacks in priority order: (a) point `TENANT_DATABASE_URL` at a **direct**
(non-pooler) connection for the tenant pool; (b) fall back to a single connection with
`SET LOCAL ROLE tenant_app` per shop-transaction — this preserves DB-level enforcement *inside*
scoped transactions but degrades the default to fail-open (base connection stays `service_role`),
so it is a last resort and must be called out if taken.

### 2. GUC + ALS threading — `packages/shared/src/db/client.ts`

- Add `const txStore = new AsyncLocalStorage<{ tx: TxHandle }>()` (Deno: `node:async_hooks`).
- The existing proxy's `get` trap: if `txStore.getStore()` has a `tx`, resolve the property on the
  transaction handle; otherwise resolve on the base pool (which, being `tenant_app` with no GUC
  set, denies RLS-table access = fail-closed).
- New helper (exported from the shared db package):

  ```ts
  export async function withShopTx<T>(
    ctx: { shopId?: string; customerId?: number },
    fn: () => Promise<T>,
  ): Promise<T> {
    return await baseDb.transaction(async (tx) => {
      // Set only the GUC(s) relevant to this request's identity. is_local=true
      // scopes them to this transaction; reset automatically at COMMIT.
      if (ctx.shopId && ctx.shopId !== OWNER_ALL_SHOPS) {
        await tx.execute(sql`select set_config('app.shop_id', ${ctx.shopId}, true)`);
      }
      if (ctx.customerId != null) {
        await tx.execute(sql`select set_config('app.customer_id', ${String(ctx.customerId)}, true)`);
      }
      return await txStore.run({ tx }, fn);
    });
  }
  ```

  Every `db.x` inside `fn` transparently runs on `tx` with the GUC set. **Staff requests set
  `app.shop_id`; customer requests set `app.customer_id`.** An `owner` with a selected shop is a
  staff request (`app.shop_id` = selected shop). An `owner` with no shop (`OWNER_ALL_SHOPS`) does
  not use `withShopTx` at all — those reads go through `dbAdmin`.

- `dbAdmin`: a second `createDbClient` over `DATABASE_URL` (today's `service_role` string),
  exported for the explicit bootstrap/system/owner-all paths above.

### 3. Wrap points (~30–50, not 399)

- **CRUD routes:** a Hono middleware `withTenantTx` mounted *after* `requireShopContext` opens a
  shop-transaction around the handler's DB phase using the resolved `shopId`/`customerId`.
- **Streaming chat routes:** do **not** wrap the whole handler (can't hold a transaction across the
  stream). Instead the **agent tool executor** wraps each tool invocation in `withShopTx(ctx)` —
  tools are the only place a chat turn touches tenant tables, and the connection is held only for
  that tool's DB work.
- **Bootstrap paths that must NOT be scoped** (switch explicitly to `dbAdmin`): `requireShopContext`
  (resolves user→shop before a shop is known — chicken-and-egg), Stripe webhook, owner all-shops
  reads, migrations/scripts, `handle_new_user`.

### 4. Policies (the 7 tables)

Identity is expressed via two GUCs; a request sets only the one matching its identity. Unset GUCs
read as NULL via `nullif(current_setting(..., true), '')`, making that clause false.

```sql
-- orders: staff sees own shop; customer sees own orders across any shop
CREATE POLICY orders_tenant ON orders FOR ALL
  USING (
    shop_id     = nullif(current_setting('app.shop_id',    true), '')::uuid
    OR customer_id = nullif(current_setting('app.customer_id', true), '')::int
  )
  WITH CHECK (
    shop_id     = nullif(current_setting('app.shop_id',    true), '')::uuid
    OR customer_id = nullif(current_setting('app.customer_id', true), '')::int
  );

-- customers: staff sees own-shop customers; a customer sees own row
CREATE POLICY customers_tenant ON customers FOR ALL
  USING (
    shop_id = nullif(current_setting('app.shop_id', true), '')::uuid
    OR id    = nullif(current_setting('app.customer_id', true), '')::int
  )
  WITH CHECK (...same...);

-- providers: shop-scoped only (no customer clause)
CREATE POLICY providers_tenant ON providers FOR ALL
  USING (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
  WITH CHECK (...same...);

-- child tables: scoped by parent visibility (inner SELECT is itself RLS-filtered)
CREATE POLICY order_intake_tenant ON order_intake FOR ALL
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_intake.order_id))
  WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_intake.order_id));
-- order_events → orders (same shape)
-- provider_availability, provider_schedule_overrides → providers (EXISTS over providers by provider_id)
```

`WITH CHECK` on write commands blocks writing a row into another tenant.

**Open detail for the plan:** a customer request sets no `app.shop_id`, so a *direct* read of
`providers` (e.g. showing the assigned mechanic's name on the customer's order-detail) is denied.
Resolve by reading that one field via `dbAdmin`, or denormalizing the mechanic name onto the order.
Decide during planning; not a blocker.

### 5. Rollout (dev == prod; a wrong policy locks out the live app — staged + instantly reversible)

1. **Role + wiring, RLS OFF.** Create `tenant_app`, grants, `TENANT_DATABASE_URL` (Infisical +
   Deno Deploy). Deploy code using the `db` (tenant_app) / `dbAdmin` split + `withShopTx` — but with
   **no policies and RLS disabled**, `tenant_app` reads everything, so behavior is identical to
   today. This shakes out grant/wiring bugs at **zero isolation risk**.
2. **Policies + ENABLE.** One idempotent migration adds all policies and `ENABLE`/`FORCE ROW LEVEL
   SECURITY` on the 7 tables. GUC threading is already live, so scoped queries work; a missed wrap
   starts failing (fail-closed → 0 rows/500, safe, not a leak) → caught by logs + the L2 test.
3. **Rollback lever.** An idempotent down migration `DISABLE ROW LEVEL SECURITY` reverts to
   app-layer-only in seconds with no code change (`tenant_app` retains grants).

No staging DB exists, so step 1's "RLS-off" deploy *is* the safety net: the code-path split is
validated in prod with isolation still off, then RLS flips on as an independent, second migration
that is instantly reversible.

### 6. Testing

- **Unit:** `withShopTx` / ALS-proxy routing — a query inside the wrapper runs on the tx (GUC set),
  a query outside uses the base pool. Pure-logic, no live DB.
- **L2 real-DB (the proof, extends existing `tenant_db_test.ts`):** connect **as `tenant_app`**,
  `set_config('app.shop_id', shopA)` → see only shopA rows; read a shopB order id → 0 rows;
  `UPDATE` a shopB order → 0 rows affected; with `app.customer_id` → own orders across shops
  visible, others invisible; child-table reads obey parent visibility. This proves RLS independent
  of app code.
- **Keep** the Phase-1 app-layer guard test (`tenant-guard_test.ts`) — RLS sits *behind* it; both
  layers stay.

## Files (anticipated — finalized in the plan)

- `packages/shared/src/db/client.ts` — ALS store, proxy tx-routing, `withShopTx`, `dbAdmin` export.
- `apps/gateway/src/middleware/with-tenant-tx.ts` — **create**. Hono middleware wrapping CRUD
  handlers.
- Agent tool executor (`apps/agent/src/hmls/...`) — wrap each tool run in `withShopTx`.
- Bootstrap sites (`shop-context.ts`, webhook, owner-all reads, scripts) — switch to `dbAdmin`.
- `apps/agent/migrations/0038_tenant_app_role.sql` — role + grants (RLS off).
- `apps/agent/migrations/0039_enable_rls.sql` — policies + ENABLE/FORCE (+ matching disable for
  rollback).
- `apps/agent/src/db/tenant_db_test.ts` — extend with tenant_app-connection isolation assertions.

## Out of scope

- Per-tenant customer rows / external-tenant `customer → shop` entry model (later phase).
- City-page → shop pre-routing (deferred in the area-shop-bridge plan).
