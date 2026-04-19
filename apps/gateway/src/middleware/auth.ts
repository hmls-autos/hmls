import type { Env } from "hono";
import { createMiddleware } from "hono/factory";
import { type AuthUser, verifyToken } from "../lib/supabase.ts";
import { db, schema } from "@hmls/agent/db";
import { eq } from "drizzle-orm";

/** Env type for routes that require authentication. */
export type AuthEnv = Env & {
  Variables: {
    authUser: AuthUser;
    customerId: number;
  };
};

/** Env type for routes with optional authentication. */
export type OptionalAuthEnv = Env & {
  Variables: {
    authUser?: AuthUser;
  };
};

/**
 * Requires a valid JWT. Sets `authUser` (id, email) and `customerId` on context.
 * Returns 401 if missing/invalid token, 403 if no customer record found.
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Missing authorization header" } },
      401,
    );
  }

  const token = auth.slice(7);
  const user = await verifyToken(token);
  if (!user) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } },
      401,
    );
  }

  const [customer] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.email, user.email))
    .limit(1);

  if (!customer) {
    return c.json(
      { error: { code: "FORBIDDEN", message: "No customer account found" } },
      403,
    );
  }

  c.set("authUser", user);
  c.set("customerId", customer.id);
  await next();
});

/**
 * Extracts and verifies JWT if present, but allows anonymous access.
 * Sets `authUser` on context when a valid token is provided.
 */
export const optionalAuth = createMiddleware<OptionalAuthEnv>(async (c, next) => {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const user = await verifyToken(token);
    if (user) {
      c.set("authUser", user);
    }
  }
  await next();
});

/**
 * Env type for routes that require a signed-in user but manage their own
 * customer record (e.g. upsert-on-first-contact).
 */
export type AuthUserEnv = Env & {
  Variables: {
    authUser: AuthUser;
  };
};

/**
 * Requires a valid JWT but does NOT require a pre-existing customer row.
 * Use for routes whose handler creates or upserts the customer inline
 * (e.g. first-contact chat). Returns 401 on missing/invalid token.
 */
export const requireAuthUser = createMiddleware<AuthUserEnv>(async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
      401,
    );
  }

  const token = auth.slice(7);
  const user = await verifyToken(token);
  if (!user) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } },
      401,
    );
  }

  c.set("authUser", user);
  await next();
});
