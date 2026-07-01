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
      if (!url) {
        throw new Error("TENANT_DATABASE_URL/DATABASE_URL environment variable is required");
      }
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
  const db = proxy(
    () => (txStore.getStore()?.executor as ReturnType<typeof drizzle<T>>) ?? tenantDb(),
  );
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
