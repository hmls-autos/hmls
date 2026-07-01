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
