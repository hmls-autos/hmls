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
      name: `${MARK} A`,
      slug: `${MARK}-a-${crypto.randomUUID()}`,
    }).returning();
    const [b] = await db.insert(schema.shops).values({
      name: `${MARK} B`,
      slug: `${MARK}-b-${crypto.randomUUID()}`,
    }).returning();
    const [ca] = await db.insert(schema.customers).values({ name: `${MARK} ca`, shopId: a.id })
      .returning();
    const [cb] = await db.insert(schema.customers).values({ name: `${MARK} cb`, shopId: b.id })
      .returning();
    const [oa] = await db.insert(schema.orders).values({
      shopId: a.id,
      customerId: ca.id,
      shareToken: `${MARK}-oa-${crypto.randomUUID()}`,
    }).returning();
    const [ob] = await db.insert(schema.orders).values({
      shopId: b.id,
      customerId: cb.id,
      shareToken: `${MARK}-ob-${crypto.randomUUID()}`,
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
