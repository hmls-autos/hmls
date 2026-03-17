import { Hono } from "hono";
import { z } from "zod";
import Stripe from "stripe";
import { db, schema } from "@hmls/agent/db";
import { and, desc, eq } from "drizzle-orm";
import { Errors } from "@hmls/shared/errors";
import { type AuthEnv, requireAuth } from "../middleware/auth.ts";
import { notifyOrderStatusChange } from "@hmls/agent";

const portal = new Hono<AuthEnv>();

portal.use("*", requireAuth);

// GET /me — current customer profile
portal.get("/me", async (c) => {
  const customerId = c.get("customerId");
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);

  if (!customer) throw Errors.notFound("Customer", customerId);
  return c.json(customer);
});

// PUT /me — update customer profile
const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().max(20).optional(),
  address: z.string().optional(),
  vehicleInfo: z.object({
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.string().optional(),
  }).optional(),
});

portal.put("/me", async (c) => {
  const customerId = c.get("customerId");
  const body = await c.req.json();
  const parsed = updateProfileSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: parsed.error.issues.map((i) => i.message).join(", "),
        },
      },
      400,
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
  if (parsed.data.address !== undefined) updates.address = parsed.data.address;
  if (parsed.data.vehicleInfo !== undefined) updates.vehicleInfo = parsed.data.vehicleInfo;

  if (Object.keys(updates).length === 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "No fields to update" } },
      400,
    );
  }

  const [updated] = await db
    .update(schema.customers)
    .set(updates)
    .where(eq(schema.customers.id, customerId))
    .returning();

  if (!updated) throw Errors.notFound("Customer", customerId);
  return c.json(updated);
});

// GET /me/bookings — customer's bookings
portal.get("/me/bookings", async (c) => {
  const customerId = c.get("customerId");
  const rows = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.customerId, customerId))
    .orderBy(desc(schema.bookings.scheduledAt));

  return c.json(rows);
});

// GET /me/orders — customer's orders (unified — replaces estimates + quotes)
portal.get("/me/orders", async (c) => {
  const customerId = c.get("customerId");
  const rows = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.customerId, customerId))
    .orderBy(desc(schema.orders.createdAt));

  return c.json(rows);
});

// GET /me/orders/:id — single order detail with events (customer-scoped)
portal.get("/me/orders/:id", async (c) => {
  const customerId = c.get("customerId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order || order.customerId !== customerId) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  const events = await db
    .select()
    .from(schema.orderEvents)
    .where(eq(schema.orderEvents.orderId, id))
    .orderBy(desc(schema.orderEvents.createdAt));

  return c.json({ order, events });
});

// GET /me/estimates — backward compat redirect to orders
portal.get("/me/estimates", async (c) => {
  const customerId = c.get("customerId");
  const rows = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.customerId, customerId))
    .orderBy(desc(schema.orders.createdAt));

  return c.json(rows);
});

// GET /me/quotes — backward compat redirect to orders
portal.get("/me/quotes", async (c) => {
  const customerId = c.get("customerId");
  const rows = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.customerId, customerId))
    .orderBy(desc(schema.orders.createdAt));

  return c.json(rows);
});

// POST /me/orders/:id/approve — customer approves estimate (status: estimated → approved)
portal.post("/me/orders/:id/approve", async (c) => {
  const customerId = c.get("customerId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order || order.customerId !== customerId) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  if (order.status !== "estimated") {
    return c.json(
      { error: { code: "BAD_REQUEST", message: `Order is '${order.status}', not 'estimated'` } },
      400,
    );
  }

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const [updated] = await db
    .update(schema.orders)
    .set({
      status: "approved",
      statusHistory: [
        ...history,
        { status: "approved", timestamp: new Date().toISOString(), actor: "customer" },
      ],
      updatedAt: new Date(),
    })
    .where(and(eq(schema.orders.id, id), eq(schema.orders.status, "estimated")))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "CONFLICT", message: "Order status changed concurrently" } },
      409,
    );
  }

  await db.insert(schema.orderEvents).values({
    orderId: id,
    eventType: "status_change",
    fromStatus: "estimated",
    toStatus: "approved",
    actor: "customer",
    metadata: {},
  });

  notifyOrderStatusChange(id, "approved");
  return c.json(updated);
});

// POST /me/orders/:id/decline — customer declines estimate (status: estimated → declined)
portal.post("/me/orders/:id/decline", async (c) => {
  const customerId = c.get("customerId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order || order.customerId !== customerId) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  if (order.status !== "estimated") {
    return c.json(
      { error: { code: "BAD_REQUEST", message: `Order is '${order.status}', not 'estimated'` } },
      400,
    );
  }

  const body = await c.req.json<{ reason?: string }>().catch(() => ({}));
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const [updated] = await db
    .update(schema.orders)
    .set({
      status: "declined",
      statusHistory: [
        ...history,
        { status: "declined", timestamp: new Date().toISOString(), actor: "customer" },
      ],
      cancellationReason: (body as { reason?: string }).reason ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.orders.id, id), eq(schema.orders.status, "estimated")))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "CONFLICT", message: "Order status changed concurrently" } },
      409,
    );
  }

  await db.insert(schema.orderEvents).values({
    orderId: id,
    eventType: "status_change",
    fromStatus: "estimated",
    toStatus: "declined",
    actor: "customer",
    metadata: {},
  });

  notifyOrderStatusChange(id, "declined");
  return c.json(updated);
});

// POST /me/orders/:id/preauth — customer authorizes payment (approved → preauth)
portal.post("/me/orders/:id/preauth", async (c) => {
  const customerId = c.get("customerId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order || order.customerId !== customerId) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  if (order.status !== "approved") {
    return c.json(
      { error: { code: "BAD_REQUEST", message: `Order is '${order.status}', not 'approved'` } },
      400,
    );
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) {
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Stripe not configured" } }, 500);
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2026-02-25.clover" });

  // Ensure customer has a Stripe customer ID
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);

  let stripeCustomerId = customer?.stripeCustomerId;
  if (!stripeCustomerId) {
    const stripeCustomer = await stripe.customers.create({
      email: customer?.email ?? undefined,
      name: customer?.name ?? undefined,
      phone: customer?.phone ?? undefined,
      metadata: { customerId: String(customerId) },
    });
    stripeCustomerId = stripeCustomer.id;
    await db
      .update(schema.customers)
      .set({ stripeCustomerId: stripeCustomer.id })
      .where(eq(schema.customers.id, customerId));
  }

  const preauthAmountCents = Math.ceil(order.subtotalCents * 1.15);

  const pi = await stripe.paymentIntents.create({
    amount: preauthAmountCents,
    currency: "usd",
    capture_method: "manual",
    customer: stripeCustomerId,
    metadata: { orderId: String(order.id) },
  });

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const [updated] = await db
    .update(schema.orders)
    .set({
      stripePaymentIntentId: pi.id,
      preauthAmountCents,
      status: "preauth",
      statusHistory: [
        ...history,
        { status: "preauth", timestamp: new Date().toISOString(), actor: "customer" },
      ],
      updatedAt: new Date(),
    })
    .where(and(eq(schema.orders.id, id), eq(schema.orders.status, "approved")))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "CONFLICT", message: "Order status changed concurrently" } },
      409,
    );
  }

  await db.insert(schema.orderEvents).values({
    orderId: id,
    eventType: "status_change",
    fromStatus: "approved",
    toStatus: "preauth",
    actor: "customer",
    metadata: {},
  });

  notifyOrderStatusChange(id, "preauth");
  return c.json({ clientSecret: pi.client_secret, preauthAmountCents });
});

// POST /me/orders/:id/confirm-preauth — verify card was confirmed on frontend
portal.post("/me/orders/:id/confirm-preauth", async (c) => {
  const customerId = c.get("customerId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order || order.customerId !== customerId) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  if (!order.stripePaymentIntentId) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "No payment intent on this order" } },
      400,
    );
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) {
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Stripe not configured" } }, 500);
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2026-02-25.clover" });
  const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);

  if (pi.status !== "requires_capture") {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: `PaymentIntent status is '${pi.status}', expected 'requires_capture'`,
        },
      },
      400,
    );
  }

  return c.json({ success: true, status: "preauth" });
});

export { portal };
