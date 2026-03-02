import { Hono } from "hono";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import { count, desc, eq, gte, sql } from "drizzle-orm";
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
    [bookingCount],
    [estimateCount],
    [quoteCount],
    [orderCount],
    upcomingBookings,
    recentCustomers,
    pendingQuotes,
  ] = await Promise.all([
    db.select({ count: count() }).from(schema.customers),
    db.select({ count: count() }).from(schema.bookings),
    db.select({ count: count() }).from(schema.estimates),
    db.select({ count: count() }).from(schema.quotes),
    db.select({ count: count() }).from(schema.orders),
    db
      .select()
      .from(schema.bookings)
      .where(gte(schema.bookings.scheduledAt, now))
      .orderBy(schema.bookings.scheduledAt)
      .limit(5),
    db
      .select()
      .from(schema.customers)
      .orderBy(desc(schema.customers.createdAt))
      .limit(5),
    db
      .select()
      .from(schema.quotes)
      .where(
        sql`${schema.quotes.status} IN ('draft', 'sent')`,
      )
      .orderBy(desc(schema.quotes.createdAt))
      .limit(5),
  ]);

  // Revenue: sum of paid quotes in last 30 days
  const [revenueResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.quotes.totalAmount}), 0)` })
    .from(schema.quotes)
    .where(
      sql`${schema.quotes.status} = 'paid' AND ${schema.quotes.createdAt} >= ${thirtyDaysAgo.toISOString()}`,
    );

  return c.json({
    stats: {
      customers: customerCount.count,
      bookings: bookingCount.count,
      estimates: estimateCount.count,
      quotes: quoteCount.count,
      orders: orderCount.count,
      revenue30d: revenueResult.total,
    },
    upcomingBookings,
    recentCustomers,
    pendingQuotes,
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
      sql`(${schema.customers.name} ILIKE ${"%" + search + "%"} OR ${schema.customers.email} ILIKE ${"%" + search + "%"} OR ${schema.customers.phone} ILIKE ${"%" + search + "%"})`,
    );
  }

  const rows = await query.limit(100);
  return c.json(rows);
});

// GET /customers/:id — single customer with their bookings/estimates/quotes
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

  const [bookings, estimates, quotes] = await Promise.all([
    db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.customerId, id))
      .orderBy(desc(schema.bookings.scheduledAt)),
    db
      .select()
      .from(schema.estimates)
      .where(eq(schema.estimates.customerId, id))
      .orderBy(desc(schema.estimates.createdAt)),
    db
      .select()
      .from(schema.quotes)
      .where(eq(schema.quotes.customerId, id))
      .orderBy(desc(schema.quotes.createdAt)),
  ]);

  return c.json({ customer, bookings, estimates, quotes });
});

// GET /bookings — all bookings
admin.get("/bookings", async (c) => {
  const status = c.req.query("status");
  let query = db
    .select({
      booking: schema.bookings,
      customerName: schema.customers.name,
      customerEmail: schema.customers.email,
      customerPhone: schema.customers.phone,
    })
    .from(schema.bookings)
    .leftJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .orderBy(desc(schema.bookings.scheduledAt))
    .$dynamic();

  if (status) {
    query = query.where(eq(schema.bookings.status, status));
  }

  const rows = await query.limit(200);
  return c.json(
    rows.map((r) => ({
      ...r.booking,
      customer: {
        name: r.customerName,
        email: r.customerEmail,
        phone: r.customerPhone,
      },
    })),
  );
});

// GET /estimates — all estimates
admin.get("/estimates", async (c) => {
  const rows = await db
    .select({
      estimate: schema.estimates,
      customerName: schema.customers.name,
      customerEmail: schema.customers.email,
    })
    .from(schema.estimates)
    .leftJoin(schema.customers, eq(schema.estimates.customerId, schema.customers.id))
    .orderBy(desc(schema.estimates.createdAt))
    .limit(200);

  return c.json(
    rows.map((r) => ({
      ...r.estimate,
      customer: { name: r.customerName, email: r.customerEmail },
    })),
  );
});

// DELETE /estimates/batch — bulk delete
admin.delete("/estimates/batch", async (c) => {
  const body = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return c.json({ error: { code: "BAD_REQUEST", message: "ids must be a non-empty array of positive integers" } }, 400);
  }
  await db.delete(schema.estimates).where(sql`${schema.estimates.id} IN ${body.ids}`);
  return c.json({ success: true, deleted: body.ids.length });
});

// DELETE /estimates/:id
admin.delete("/estimates/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } }, 400);
  }

  const [existing] = await db
    .select({ id: schema.estimates.id })
    .from(schema.estimates)
    .where(eq(schema.estimates.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ error: { code: "NOT_FOUND", message: "Estimate not found" } }, 404);
  }

  await db.delete(schema.estimates).where(eq(schema.estimates.id, id));
  return c.json({ success: true });
});

// GET /quotes — all quotes
admin.get("/quotes", async (c) => {
  const status = c.req.query("status");
  let query = db
    .select({
      quote: schema.quotes,
      customerName: schema.customers.name,
      customerEmail: schema.customers.email,
    })
    .from(schema.quotes)
    .leftJoin(schema.customers, eq(schema.quotes.customerId, schema.customers.id))
    .orderBy(desc(schema.quotes.createdAt))
    .$dynamic();

  if (status) {
    query = query.where(eq(schema.quotes.status, status));
  }

  const rows = await query.limit(200);
  return c.json(
    rows.map((r) => ({
      ...r.quote,
      customer: { name: r.customerName, email: r.customerEmail },
    })),
  );
});

export { admin };
