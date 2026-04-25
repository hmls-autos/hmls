import type { Env } from "hono";
import { createMiddleware } from "hono/factory";
import { type AuthUser, verifyToken } from "../lib/supabase.ts";

/** Env type for mechanic routes. Guarantees `providerId` is set. */
export type MechanicEnv = Env & {
  Variables: {
    authUser: AuthUser;
    providerId: number;
  };
};

/**
 * Allows any user whose JWT carries a `provider_id` claim, regardless of role.
 * Migration 0012 changed the RBAC hook to inject `provider_id` whenever an
 * active providers row links to the auth user, so admins who own a shop and
 * want to act as mechanics get the claim alongside their `admin` user_role.
 * Returns 401 if token missing/invalid, 403 if no provider_id claim.
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

  if (typeof user.providerId !== "number") {
    return c.json(
      { error: { code: "FORBIDDEN", message: "Mechanic access required" } },
      403,
    );
  }

  c.set("authUser", user);
  c.set("providerId", user.providerId);
  await next();
});
