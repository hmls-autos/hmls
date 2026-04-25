import type { Env } from "hono";
import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db, schema } from "@hmls/agent/db";
import { type AuthUser, verifyToken } from "../lib/supabase.ts";

/** Env type for mechanic routes. Guarantees `providerId` is set. */
export type MechanicEnv = Env & {
  Variables: {
    authUser: AuthUser;
    providerId: number;
  };
};

/** Resolve providerId for an admin via the `auth_user_id` link on the
 *  `providers` table. Returns null if not linked. */
async function providerIdForAdmin(authUserId: string): Promise<number | null> {
  const [row] = await db
    .select({ id: schema.providers.id })
    .from(schema.providers)
    .where(eq(schema.providers.authUserId, authUserId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Allows mechanic-role users (with `provider_id` from custom_access_token_hook)
 * and admin-role users whose Supabase `id` is linked to `providers.auth_user_id`.
 * Returns 401 if token missing/invalid, 403 if neither condition is met.
 */
export const requireMechanic = createMiddleware<MechanicEnv>(async (c, next) => {
  // Dev bypass for local testing
  if (Deno.env.get("SKIP_AUTH") === "true") {
    const devProviderId = Number(Deno.env.get("DEV_PROVIDER_ID") ?? "1");
    c.set("authUser", {
      id: "dev-mechanic",
      email: "mechanic@localhost",
      role: "mechanic",
      providerId: devProviderId,
    });
    c.set("providerId", devProviderId);
    await next();
    return;
  }

  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Missing authorization header" } },
      401,
    );
  }

  const user = await verifyToken(auth.slice(7));
  if (!user) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } },
      401,
    );
  }

  // Mechanic-role JWT carries provider_id directly.
  if (user.role === "mechanic" && typeof user.providerId === "number") {
    c.set("authUser", user);
    c.set("providerId", user.providerId);
    await next();
    return;
  }

  // Admin can act as mechanic when their Supabase id is linked to a
  // provider row via `auth_user_id`.
  if (user.role === "admin") {
    const providerId = await providerIdForAdmin(user.id);
    if (providerId != null) {
      c.set("authUser", { ...user, providerId });
      c.set("providerId", providerId);
      await next();
      return;
    }
  }

  return c.json(
    { error: { code: "FORBIDDEN", message: "Mechanic access required" } },
    403,
  );
});
