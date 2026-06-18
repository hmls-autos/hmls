import type { Env } from "hono";
import { createMiddleware } from "hono/factory";
import { db, schema } from "@hmls/agent/db";
import { eq } from "drizzle-orm";
import type { AuthUser } from "../lib/supabase.ts";

/** Sentinel: an owner with no selected shop — reads span all shops, writes are blocked. */
export const OWNER_ALL_SHOPS = "__all__";

export type ShopEnv = Env & {
  Variables: {
    authUser: AuthUser;
    shopId: string;
    isOwner: boolean;
  };
};

type PickInput = {
  role: string | null | undefined;
  homeShopId: string | null;
  headerShopId: string | null;
  validShopIds: string[];
};
type PickResult =
  | { shopId: string; isOwner: boolean }
  | { error: "NO_SHOP" | "BAD_SHOP" };

/** Pure shop-context decision. No DB / no I/O — unit tested. */
export function pickShopId(input: PickInput): PickResult {
  const { role, homeShopId, headerShopId, validShopIds } = input;
  if (role === "owner") {
    if (headerShopId == null) return { shopId: OWNER_ALL_SHOPS, isOwner: true };
    if (!validShopIds.includes(headerShopId)) return { error: "BAD_SHOP" };
    return { shopId: headerShopId, isOwner: true };
  }
  if (homeShopId == null) return { error: "NO_SHOP" };
  return { shopId: homeShopId, isOwner: false };
}

async function loadValidShopIds(): Promise<string[]> {
  const rows = await db.select({ id: schema.shops.id }).from(schema.shops);
  return rows.map((r) => r.id);
}

/** Resolves ctx.shopId + ctx.isOwner. Mount AFTER requireAdmin/requireAuth/requireMechanic. */
export const requireShopContext = createMiddleware<ShopEnv>(async (c, next) => {
  if (Deno.env.get("SKIP_AUTH") === "true") {
    const devShop = Deno.env.get("DEV_SHOP_ID");
    if (!devShop) {
      return c.json({ error: { code: "NO_SHOP", message: "DEV_SHOP_ID not set" } }, 500);
    }
    c.set("shopId", devShop);
    c.set("isOwner", false);
    await next();
    return;
  }

  const user = c.get("authUser");
  const role = user.role;

  let homeShopId: string | null = null;
  if (role === "mechanic") {
    const [p] = await db.select({ shopId: schema.providers.shopId })
      .from(schema.providers).where(eq(schema.providers.authUserId, user.id)).limit(1);
    homeShopId = p?.shopId ?? null;
  } else if (role === "admin" || role === "customer") {
    // admin + customer are both `customers` rows. Match by auth_user_id, with an
    // email fallback (mirrors requireAuth) so guests who later sign in still resolve.
    let [cust] = await db.select({ shopId: schema.customers.shopId })
      .from(schema.customers).where(eq(schema.customers.authUserId, user.id)).limit(1);
    if (!cust && user.email) {
      [cust] = await db.select({ shopId: schema.customers.shopId })
        .from(schema.customers).where(eq(schema.customers.email, user.email)).limit(1);
    }
    homeShopId = cust?.shopId ?? null;
  }

  const headerShopId = c.req.header("X-Shop-Id") ?? null;
  const validShopIds = role === "owner" ? await loadValidShopIds() : [];

  const picked = pickShopId({ role, homeShopId, headerShopId, validShopIds });
  if ("error" in picked) {
    const message = picked.error === "NO_SHOP"
      ? "No shop assigned to this account"
      : "Unknown shop";
    return c.json({ error: { code: picked.error, message } }, 403);
  }
  c.set("shopId", picked.shopId);
  c.set("isOwner", picked.isOwner);
  await next();
});
