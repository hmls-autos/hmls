import { Hono } from "hono";
import { db, schema } from "@hmls/agent/db";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { type AdminEnv, requireAdmin } from "../middleware/admin.ts";

const admin = new Hono<AdminEnv>();

// All admin routes require admin role
admin.use("*", requireAdmin);

// GET /dashboard — KPI stats
admin.get("/dashboard", async (c) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    [customerCount],
    [orderCount],
    upcomingBookings,
    recentCustomers,
  ] = await Promise.all([
    db.select({ count: count() }).from(schema.customers),
    db.select({ count: count() }).from(schema.orders),
    db
      .select()
      .from(schema.orders)
      .where(
        and(
          gte(schema.orders.scheduledAt, now),
          sql`${schema.orders.status} IN ('scheduled', 'in_progress')`,
        ),
      )
      .orderBy(schema.orders.scheduledAt)
      .limit(5),
    db
      .select()
      .from(schema.customers)
      .orderBy(desc(schema.customers.createdAt))
      .limit(5),
  ]);

  // Revenue: captured amount on completed orders in last 30 days
  const [revenueResult] = await db
    .select({
      total: sql<
        number
      >`COALESCE(SUM(COALESCE(${schema.orders.capturedAmountCents}, ${schema.orders.subtotalCents})), 0)`,
    })
    .from(schema.orders)
    .where(
      sql`${schema.orders.status} = 'completed' AND ${schema.orders.createdAt} >= ${thirtyDaysAgo.toISOString()}`,
    );

  const [pendingReview] = await db
    .select({ count: count() })
    .from(schema.orders)
    .where(eq(schema.orders.status, "draft"));

  const [pendingApprovals] = await db
    .select({ count: count() })
    .from(schema.orders)
    .where(eq(schema.orders.status, "estimated"));

  const [activeJobs] = await db
    .select({ count: count() })
    .from(schema.orders)
    .where(
      sql`${schema.orders.status} IN ('approved', 'scheduled', 'in_progress')`,
    );

  return c.json({
    stats: {
      customers: customerCount.count,
      orders: orderCount.count,
      pendingReview: pendingReview.count,
      pendingApprovals: pendingApprovals.count,
      activeJobs: activeJobs.count,
      revenue30d: revenueResult.total,
    },
    upcomingOrders: upcomingBookings.map((o) => ({
      id: o.id,
      scheduledAt: o.scheduledAt,
      contactName: o.contactName,
      vehicleInfo: o.vehicleInfo,
      status: o.status,
    })),
    recentCustomers,
  });
});

// GET /customers — all customers
admin.get("/customers", async (c) => {
  const search = c.req.query("search");
  let query = db
    .select()
    .from(schema.customers)
    .orderBy(desc(schema.customers.createdAt))
    .$dynamic();

  if (search) {
    query = query.where(
      sql`(${schema.customers.name} ILIKE ${
        "%" + search + "%"
      } OR ${schema.customers.email} ILIKE ${
        "%" + search + "%"
      } OR ${schema.customers.phone} ILIKE ${"%" + search + "%"})`,
    );
  }

  const rows = await query.limit(100);
  return c.json(rows);
});

// GET /customers/:id — single customer with their orders
admin.get("/customers/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid customer ID" } }, 400);
  }

  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1);

  if (!customer) {
    return c.json({ error: { code: "NOT_FOUND", message: "Customer not found" } }, 404);
  }

  const orders = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.customerId, id))
    .orderBy(desc(schema.orders.createdAt));

  return c.json({ customer, orders });
});

// PATCH /customers/:id — update customer
admin.patch("/customers/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid customer ID" } }, 400);
  }

  const body = await c.req.json<{
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    vehicleInfo?: Record<string, unknown>;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.email !== undefined) updates.email = body.email;
  if (body.address !== undefined) updates.address = body.address;
  if (body.vehicleInfo !== undefined) updates.vehicleInfo = body.vehicleInfo;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "No fields to update" } }, 400);
  }

  const [updated] = await db
    .update(schema.customers)
    .set(updates)
    .where(eq(schema.customers.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Customer not found" } }, 404);
  }

  return c.json(updated);
});

// POST /customers — create customer
admin.post("/customers", async (c) => {
  const body = await c.req.json<{
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    vehicleInfo?: Record<string, unknown>;
  }>();

  if (!body.name && !body.email && !body.phone) {
    return c.json({
      error: { code: "BAD_REQUEST", message: "At least one of name, email, or phone is required" },
    }, 400);
  }

  const [customer] = await db
    .insert(schema.customers)
    .values({
      name: body.name ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      address: body.address ?? null,
      vehicleInfo: body.vehicleInfo ?? null,
      role: "customer",
    })
    .returning();

  return c.json(customer, 201);
});

// DELETE /customers/:id — delete customer
admin.delete("/customers/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid customer ID" } }, 400);
  }

  const [existing] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ error: { code: "NOT_FOUND", message: "Customer not found" } }, 404);
  }

  await db.delete(schema.customers).where(eq(schema.customers.id, id));
  return c.json({ success: true });
});

export { admin };
