import { Hono } from "hono";
import { db, schema } from "@hmls/agent/db";
import { count, desc, eq, gte, inArray, sql } from "drizzle-orm";
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

  // Revenue: sum of paid orders in last 30 days
  const [revenueResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.orders.subtotalCents}), 0)` })
    .from(schema.orders)
    .where(
      sql`${schema.orders.status} IN ('paid', 'scheduled', 'in_progress', 'completed', 'archived') AND ${schema.orders.createdAt} >= ${thirtyDaysAgo.toISOString()}`,
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
      customerPhone: schema.customers.phone,
      customerAddress: schema.customers.address,
      customerVehicleInfo: schema.customers.vehicleInfo,
      orderId: schema.orders.id,
      orderStatus: schema.orders.status,
    })
    .from(schema.estimates)
    .leftJoin(schema.customers, eq(schema.estimates.customerId, schema.customers.id))
    .leftJoin(schema.orders, eq(schema.orders.estimateId, schema.estimates.id))
    .orderBy(desc(schema.estimates.createdAt))
    .limit(200);

  return c.json(
    rows.map((r) => ({
      ...r.estimate,
      customer: {
        name: r.customerName,
        email: r.customerEmail,
        phone: r.customerPhone,
        address: r.customerAddress,
        vehicleInfo: r.customerVehicleInfo,
      },
      orderId: r.orderId,
      orderStatus: r.orderStatus,
    })),
  );
});

// PATCH /estimates/:id — update estimate (items, notes, vehicleInfo) directly on the estimates table
admin.patch("/estimates/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } }, 400);
  }

  const [existing] = await db
    .select()
    .from(schema.estimates)
    .where(eq(schema.estimates.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ error: { code: "NOT_FOUND", message: "Estimate not found" } }, 404);
  }

  const body = await c.req.json<{
    items?: { name: string; description: string; price: number }[];
    notes?: string | null;
    vehicleInfo?: { year?: number; make?: string; model?: string } | null;
    validDays?: number;
    expiresAt?: string | null;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.items !== undefined) {
    updates.items = body.items;
    const subtotal = body.items.reduce((sum, item) => sum + item.price, 0);
    updates.subtotal = subtotal;
    updates.priceRangeLow = Math.round(subtotal * 0.9);
    updates.priceRangeHigh = Math.round(subtotal * 1.1);
  }
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.vehicleInfo !== undefined) updates.vehicleInfo = body.vehicleInfo;
  if (body.validDays !== undefined) updates.validDays = body.validDays;
  if (body.expiresAt !== undefined) {
    updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "No fields to update" } }, 400);
  }

  const [updated] = await db
    .update(schema.estimates)
    .set(updates)
    .where(eq(schema.estimates.id, id))
    .returning();

  return c.json(updated);
});

// DELETE /estimates/batch — bulk delete
admin.delete("/estimates/batch", async (c) => {
  const body = await c.req.json<{ ids: number[] }>();
  if (
    !Array.isArray(body.ids) || body.ids.length === 0 ||
    body.ids.some((id) => !Number.isInteger(id) || id <= 0)
  ) {
    return c.json({
      error: { code: "BAD_REQUEST", message: "ids must be a non-empty array of positive integers" },
    }, 400);
  }
  await db.delete(schema.estimates).where(inArray(schema.estimates.id, body.ids));
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

// -------- Quote CRUD --------

// POST /quotes — create a new quote
admin.post("/quotes", async (c) => {
  const body = await c.req.json<{
    customerId: number;
    items: { name: string; description: string; price: number }[];
    totalAmount: number;
    status?: string;
    expiresAt?: string;
  }>();

  if (!body.customerId || !body.items || !body.totalAmount) {
    return c.json({
      error: { code: "BAD_REQUEST", message: "customerId, items, and totalAmount are required" },
    }, 400);
  }

  const [quote] = await db
    .insert(schema.quotes)
    .values({
      customerId: body.customerId,
      items: body.items,
      totalAmount: body.totalAmount,
      status: body.status ?? "draft",
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    })
    .returning();

  return c.json(quote, 201);
});

// PATCH /quotes/:id — update quote
admin.patch("/quotes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid quote ID" } }, 400);
  }

  const body = await c.req.json<{
    status?: string;
    items?: { name: string; description: string; price: number }[];
    totalAmount?: number;
    expiresAt?: string | null;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.status !== undefined) updates.status = body.status;
  if (body.items !== undefined) updates.items = body.items;
  if (body.totalAmount !== undefined) updates.totalAmount = body.totalAmount;
  if (body.expiresAt !== undefined) {
    updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "No fields to update" } }, 400);
  }

  const [updated] = await db
    .update(schema.quotes)
    .set(updates)
    .where(eq(schema.quotes.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Quote not found" } }, 404);
  }

  return c.json(updated);
});

// DELETE /quotes/:id
admin.delete("/quotes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid quote ID" } }, 400);
  }

  const [existing] = await db
    .select({ id: schema.quotes.id })
    .from(schema.quotes)
    .where(eq(schema.quotes.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ error: { code: "NOT_FOUND", message: "Quote not found" } }, 404);
  }

  await db.delete(schema.quotes).where(eq(schema.quotes.id, id));
  return c.json({ success: true });
});

// -------- Booking CRUD --------

// POST /bookings — create a new booking
admin.post("/bookings", async (c) => {
  const body = await c.req.json<{
    customerId?: number;
    serviceType: string;
    scheduledAt: string;
    durationMinutes?: number;
    location?: string;
    vehicleYear?: number;
    vehicleMake?: string;
    vehicleModel?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    internalNotes?: string;
    status?: string;
  }>();

  if (!body.serviceType || !body.scheduledAt) {
    return c.json({
      error: { code: "BAD_REQUEST", message: "serviceType and scheduledAt are required" },
    }, 400);
  }

  const scheduledAt = new Date(body.scheduledAt);
  const durationMinutes = body.durationMinutes ?? 60;
  const appointmentEnd = new Date(scheduledAt.getTime() + durationMinutes * 60 * 1000);

  const [booking] = await db
    .insert(schema.bookings)
    .values({
      customerId: body.customerId ?? null,
      serviceType: body.serviceType,
      scheduledAt,
      appointmentEnd,
      durationMinutes,
      location: body.location ?? null,
      vehicleYear: body.vehicleYear ?? null,
      vehicleMake: body.vehicleMake ?? null,
      vehicleModel: body.vehicleModel ?? null,
      customerName: body.customerName ?? null,
      customerEmail: body.customerEmail ?? null,
      customerPhone: body.customerPhone ?? null,
      internalNotes: body.internalNotes ?? null,
      status: body.status ?? "confirmed",
    })
    .returning();

  return c.json(booking, 201);
});

// PATCH /bookings/:id — update booking
admin.patch("/bookings/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid booking ID" } }, 400);
  }

  const body = await c.req.json<{
    status?: string;
    serviceType?: string;
    scheduledAt?: string;
    durationMinutes?: number;
    location?: string;
    vehicleYear?: number | null;
    vehicleMake?: string | null;
    vehicleModel?: string | null;
    internalNotes?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.status !== undefined) updates.status = body.status;
  if (body.serviceType !== undefined) updates.serviceType = body.serviceType;
  if (body.scheduledAt !== undefined) {
    updates.scheduledAt = new Date(body.scheduledAt);
    const dur = body.durationMinutes ?? 60;
    updates.appointmentEnd = new Date(new Date(body.scheduledAt).getTime() + dur * 60 * 1000);
  }
  if (body.durationMinutes !== undefined) updates.durationMinutes = body.durationMinutes;
  if (body.location !== undefined) updates.location = body.location;
  if (body.vehicleYear !== undefined) updates.vehicleYear = body.vehicleYear;
  if (body.vehicleMake !== undefined) updates.vehicleMake = body.vehicleMake;
  if (body.vehicleModel !== undefined) updates.vehicleModel = body.vehicleModel;
  if (body.internalNotes !== undefined) updates.internalNotes = body.internalNotes;
  if (body.customerName !== undefined) updates.customerName = body.customerName;
  if (body.customerEmail !== undefined) updates.customerEmail = body.customerEmail;
  if (body.customerPhone !== undefined) updates.customerPhone = body.customerPhone;
  updates.updatedAt = new Date();

  if (Object.keys(updates).length <= 1) {
    return c.json({ error: { code: "BAD_REQUEST", message: "No fields to update" } }, 400);
  }

  const [updated] = await db
    .update(schema.bookings)
    .set(updates)
    .where(eq(schema.bookings.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Booking not found" } }, 404);
  }

  return c.json(updated);
});

// DELETE /bookings/:id
admin.delete("/bookings/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid booking ID" } }, 400);
  }

  const [existing] = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ error: { code: "NOT_FOUND", message: "Booking not found" } }, 404);
  }

  await db.delete(schema.bookings).where(eq(schema.bookings.id, id));
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
