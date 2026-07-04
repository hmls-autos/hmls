import type { Env } from "hono";
import { createMiddleware } from "hono/factory";
import { withAdminScope, withTenantScope } from "@hmls/agent/db";
import { OWNER_ALL_SHOPS } from "./shop-context.ts";

/** Variables required in "shop" mode — matches `WithShop<E>` (shop-context.ts). */
type ShopModeEnv = Env & { Variables: { shopId: string } };
/** Variables required in "customer" mode — matches `AuthEnv` (auth.ts). */
type CustomerModeEnv = Env & { Variables: { customerId: number } };

/**
 * Wrap a scoped route handler so every `db` query inside it runs in a tenant
 * transaction with the correct RLS GUC set. Mount AFTER requireShopContext
 * (shop mode) / requireAuth (customer mode). NOT for streaming chat routes —
 * those wrap per-tool instead (see convert-tools.ts).
 *   - "shop": staff/owner routers. Owner with no shop → admin (cross-shop read).
 *   - "customer": portal. Scopes by the authed customerId.
 *
 * Overloaded on `mode` so `c.get("shopId"|"customerId")` is checked against the
 * router's actual Variables (no `as never` cast) — callers still pass a plain
 * string literal, e.g. `withTenantTx("shop")`.
 */
export function withTenantTx(mode: "shop"): ReturnType<typeof createMiddleware<ShopModeEnv>>;
export function withTenantTx(
  mode: "customer",
): ReturnType<typeof createMiddleware<CustomerModeEnv>>;
export function withTenantTx(mode: "shop" | "customer") {
  if (mode === "customer") {
    return createMiddleware<CustomerModeEnv>(async (c, next) => {
      const customerId = c.get("customerId");
      return await withTenantScope({ customerId }, next);
    });
  }
  return createMiddleware<ShopModeEnv>(async (c, next) => {
    const shopId = c.get("shopId");
    if (shopId === OWNER_ALL_SHOPS) return await withAdminScope(next);
    return await withTenantScope({ shopId }, next);
  });
}
