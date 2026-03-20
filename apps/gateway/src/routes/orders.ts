import { Hono } from "hono";
import Stripe from "stripe";
import { renderToStream } from "@react-pdf/renderer";
import { db, schema } from "@hmls/agent/db";
import { and, desc, eq } from "drizzle-orm";
import { type AdminEnv, requireAdmin } from "../middleware/admin.ts";
import { EstimatePdf, notifyOrderStatusChange } from "@hmls/agent";
import type { OrderItem } from "@hmls/agent/db";

// New status machine
const TRANSITIONS: Record<string, string[]> = {
  draft: ["estimated", "cancelled"],
  estimated: ["approved", "declined", "cancelled"],
  declined: ["revised"],
  revised: ["estimated", "cancelled"],
  approved: ["preauth", "cancelled"],
  preauth: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["invoiced", "cancelled"],
  invoiced: ["paid", "void"],
  paid: ["completed"],
  completed: ["archived"],
  // terminal
  archived: [],
  cancelled: [],
  void: [],
};

// Editable statuses
const EDITABLE_STATUSES = new Set(["draft", "revised"]);

async function logOrderEvent(
  orderId: number,
  eventType: string,
  actor: string,
  opts?: { fromStatus?: string; toStatus?: string; metadata?: Record<string, unknown> },
) {
  await db.insert(schema.orderEvents).values({
    orderId,
    eventType,
    fromStatus: opts?.fromStatus ?? null,
    toStatus: opts?.toStatus ?? null,
    actor,
    metadata: opts?.metadata ?? {},
  });
}

const orders = new Hono<AdminEnv>();

orders.use("*", requireAdmin);

// GET /orders — list all orders (with pagination)
orders.get("/", async (c) => {
  const status = c.req.query("status");
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
  const offset = (page - 1) * limit;

  let query = db
    .select()
    .from(schema.orders)
    .orderBy(desc(schema.orders.createdAt))
    .$dynamic();

  if (status) {
    query = query.where(eq(schema.orders.status, status));
  }

  const rows = await query.limit(limit).offset(offset);
  return c.json(rows);
});

// POST /orders — create a new draft order
orders.post("/", async (c) => {
  const body = await c.req.json<{
    customer_id: number;
    vehicle_year?: number;
    vehicle_make?: string;
    vehicle_model?: string;
    description?: string;
    items?: Array<{ description: string; labor_hours?: number; parts_cost?: number }>;
  }>();

  if (!body.customer_id) {
    return c.json({ error: { code: "BAD_REQUEST", message: "customer_id is required" } }, 400);
  }

  const customerId = Number(body.customer_id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid customer_id" } }, 400);
  }

  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);

  if (!customer) {
    return c.json({ error: { code: "NOT_FOUND", message: "Customer not found" } }, 404);
  }

  const vehicleInfo = body.vehicle_year || body.vehicle_make || body.vehicle_model
    ? {
      year: body.vehicle_year ? String(body.vehicle_year) : undefined,
      make: body.vehicle_make ?? undefined,
      model: body.vehicle_model ?? undefined,
    }
    : null;

  const orderItems: OrderItem[] = (body.items ?? []).map((item) => {
    const laborCents = Math.round((item.labor_hours ?? 0) * 140 * 100); // $140/hr default (matches pricing engine)
    const partsCents = Math.round((item.parts_cost ?? 0) * 100);
    const totalCents = laborCents + partsCents;
    return {
      id: crypto.randomUUID(),
      category: "labor" as const,
      name: item.description,
      quantity: 1,
      unitPriceCents: totalCents,
      totalCents,
      taxable: true,
      ...(item.labor_hours ? { laborHours: item.labor_hours } : {}),
    };
  });

  const subtotalCents = orderItems.reduce((sum, i) => sum + i.totalCents, 0);

  const authUser = c.get("authUser");
  const actor = authUser.email ?? "admin";

  const [order] = await db
    .insert(schema.orders)
    .values({
      customerId,
      status: "draft",
      statusHistory: [{ status: "draft", timestamp: new Date().toISOString(), actor }],
      items: orderItems,
      notes: body.description ?? null,
      subtotalCents,
      priceRangeLowCents: Math.round(subtotalCents * 0.9),
      priceRangeHighCents: Math.round(subtotalCents * 1.1),
      vehicleInfo: vehicleInfo ?? undefined,
      shareToken: crypto.randomUUID().replace(/-/g, ""),
      contactName: customer.name ?? null,
      contactEmail: customer.email ?? null,
      contactPhone: customer.phone ?? null,
      contactAddress: customer.address ?? null,
    })
    .returning();

  await logOrderEvent(order.id, "status_change", actor, {
    toStatus: "draft",
    metadata: { itemCount: orderItems.length },
  });

  return c.json(order, 201);
});

// GET /orders/:id — single order with related entities + events
orders.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  // Backfill shareToken if missing (legacy orders)
  if (!order.shareToken) {
    const token = crypto.randomUUID().replace(/-/g, "");
    await db.update(schema.orders).set({ shareToken: token }).where(eq(schema.orders.id, id));
    order.shareToken = token;
  }

  const [customer, booking, events] = await Promise.all([
    db.select().from(schema.customers).where(eq(schema.customers.id, order.customerId)).limit(1)
      .then((r) => r[0]),
    order.bookingId
      ? db.select().from(schema.bookings).where(eq(schema.bookings.id, order.bookingId)).limit(1)
        .then((r) => r[0])
      : null,
    db.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, id))
      .orderBy(desc(schema.orderEvents.createdAt)),
  ]);

  return c.json({ order, customer, booking, events });
});

// PATCH /orders/:id — edit order items/notes (only in editable statuses) or contact snapshot (any status)
orders.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  const body = await c.req.json<{
    items?: OrderItem[];
    notes?: string | null;
    vehicleInfo?: Record<string, unknown> | null;
    validDays?: number;
    expiresAt?: string | null;
    // Per-order contact snapshot fields (editable regardless of status)
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    contact_address?: string | null;
  }>();

  // Contact snapshot fields can be updated on any order status
  const hasContactFields = body.contact_name !== undefined ||
    body.contact_email !== undefined ||
    body.contact_phone !== undefined ||
    body.contact_address !== undefined;

  const hasItemFields = body.items !== undefined ||
    body.notes !== undefined ||
    body.vehicleInfo !== undefined ||
    body.validDays !== undefined ||
    body.expiresAt !== undefined;

  // Item/notes editing is restricted to editable statuses
  if (hasItemFields && !EDITABLE_STATUSES.has(order.status)) {
    return c.json({
      error: {
        code: "BAD_REQUEST",
        message: `Cannot edit order items in '${order.status}' status. Editable statuses: ${
          [...EDITABLE_STATUSES].join(", ")
        }`,
      },
    }, 400);
  }

  const currentStatus = order.status;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.items !== undefined) {
    updates.items = body.items;
    const subtotal = body.items.reduce((sum, item) => sum + item.totalCents, 0);
    updates.subtotalCents = subtotal;
    updates.priceRangeLowCents = Math.round(subtotal * 0.9);
    updates.priceRangeHighCents = Math.round(subtotal * 1.1);
  }
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.vehicleInfo !== undefined) updates.vehicleInfo = body.vehicleInfo;
  if (body.validDays !== undefined) updates.validDays = body.validDays;
  if (body.expiresAt !== undefined) {
    updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }
  if (body.contact_name !== undefined) updates.contactName = body.contact_name;
  if (body.contact_email !== undefined) updates.contactEmail = body.contact_email;
  if (body.contact_phone !== undefined) updates.contactPhone = body.contact_phone;
  if (body.contact_address !== undefined) updates.contactAddress = body.contact_address;

  // For item edits use optimistic concurrency; for contact-only edits skip it
  let updated: typeof order | undefined;
  if (hasItemFields) {
    const [row] = await db
      .update(schema.orders)
      .set(updates)
      .where(and(eq(schema.orders.id, id), eq(schema.orders.status, currentStatus)))
      .returning();
    updated = row;

    if (!updated) {
      return c.json({
        error: {
          code: "CONFLICT",
          message: "Order status changed concurrently — refresh and retry",
        },
      }, 409);
    }
  } else if (hasContactFields) {
    const [row] = await db
      .update(schema.orders)
      .set(updates)
      .where(eq(schema.orders.id, id))
      .returning();
    updated = row;
  } else {
    return c.json({ error: { code: "BAD_REQUEST", message: "No fields to update" } }, 400);
  }

  const authUser = c.get("authUser");
  const eventType = hasItemFields ? "items_edited" : "contact_edited";
  await logOrderEvent(id, eventType, authUser.email ?? "admin");

  return c.json(updated);
});

// PATCH /orders/:id/status — transition order status (atomic)
orders.patch("/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const body = await c.req.json<{ status: string; notes?: string; cancellationReason?: string }>();
  const newStatus = body.status;

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  const allowed = TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return c.json({
      error: {
        code: "BAD_REQUEST",
        message: `Cannot transition from '${order.status}' to '${newStatus}'. Allowed: ${
          allowed.join(", ") || "none (terminal state)"
        }`,
      },
    }, 400);
  }

  const authUser = c.get("authUser");
  const actor = authUser.email ?? "admin";

  const updateFields: Record<string, unknown> = {
    status: newStatus,
    statusHistory: [
      ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
      { status: newStatus, timestamp: new Date().toISOString(), actor },
    ],
    updatedAt: new Date(),
  };

  // Backfill shareToken if missing (legacy orders created without one)
  if (!order.shareToken) {
    updateFields.shareToken = crypto.randomUUID().replace(/-/g, "");
  }

  if (body.notes) updateFields.adminNotes = body.notes;
  if (newStatus === "cancelled" && body.cancellationReason) {
    updateFields.cancellationReason = body.cancellationReason;
  }

  // Atomic transition: only update if status hasn't changed
  const [updated] = await db
    .update(schema.orders)
    .set(updateFields)
    .where(and(eq(schema.orders.id, id), eq(schema.orders.status, order.status)))
    .returning();

  if (!updated) {
    return c.json({
      error: { code: "CONFLICT", message: "Order status changed concurrently. Please retry." },
    }, 409);
  }

  await logOrderEvent(id, "status_change", actor, {
    fromStatus: order.status,
    toStatus: newStatus,
  });

  // Fire-and-forget notification
  notifyOrderStatusChange(id, newStatus);

  return c.json(updated);
});

// POST /orders/:id/send — transition to 'estimated' + trigger notification
orders.post("/:id/send", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  const validFrom = ["draft", "revised"];
  if (!validFrom.includes(order.status)) {
    return c.json({
      error: { code: "BAD_REQUEST", message: `Cannot send order in '${order.status}' status` },
    }, 400);
  }

  const authUser = c.get("authUser");
  const actor = authUser.email ?? "admin";

  const [updated] = await db
    .update(schema.orders)
    .set({
      status: "estimated",
      statusHistory: [
        ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
        { status: "estimated", timestamp: new Date().toISOString(), actor },
      ],
      updatedAt: new Date(),
    })
    .where(and(eq(schema.orders.id, id), eq(schema.orders.status, order.status)))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "CONFLICT", message: "Order status changed concurrently" } },
      409,
    );
  }

  await logOrderEvent(id, "status_change", actor, {
    fromStatus: order.status,
    toStatus: "estimated",
  });
  notifyOrderStatusChange(id, "estimated");

  return c.json(updated);
});

// POST /orders/:id/revise — create revision from declined order
orders.post("/:id/revise", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  if (order.status !== "declined") {
    return c.json({
      error: {
        code: "BAD_REQUEST",
        message: `Cannot revise order in '${order.status}' status. Must be 'declined'.`,
      },
    }, 400);
  }

  const authUser = c.get("authUser");
  const actor = authUser.email ?? "admin";

  const [updated] = await db
    .update(schema.orders)
    .set({
      status: "revised",
      revisionNumber: (order.revisionNumber ?? 1) + 1,
      statusHistory: [
        ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
        { status: "revised", timestamp: new Date().toISOString(), actor },
      ],
      updatedAt: new Date(),
    })
    .where(and(eq(schema.orders.id, id), eq(schema.orders.status, "declined")))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "CONFLICT", message: "Order status changed concurrently" } },
      409,
    );
  }

  await logOrderEvent(id, "status_change", actor, { fromStatus: "declined", toStatus: "revised" });
  notifyOrderStatusChange(id, "revised");

  return c.json(updated);
});

// GET /orders/:id/events — audit log for an order
orders.get("/:id/events", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const events = await db
    .select()
    .from(schema.orderEvents)
    .where(eq(schema.orderEvents.orderId, id))
    .orderBy(desc(schema.orderEvents.createdAt));

  return c.json(events);
});

// POST /orders/:id/events — add a manual event (e.g. note_added)
orders.post("/:id/events", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const [order] = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  const body = await c.req.json<{
    eventType: string;
    metadata?: Record<string, unknown>;
  }>();

  if (!body.eventType) {
    return c.json({ error: { code: "BAD_REQUEST", message: "eventType is required" } }, 400);
  }

  const authUser = c.get("authUser");
  const actor = authUser.email ?? "admin";

  const [event] = await db
    .insert(schema.orderEvents)
    .values({
      orderId: id,
      eventType: body.eventType,
      actor,
      metadata: body.metadata ?? {},
    })
    .returning();

  return c.json(event, 201);
});

// POST /orders/:id/capture — capture pre-authorized payment (admin only)
orders.post("/:id/capture", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const body = await c.req.json<{ finalAmountCents: number }>();
  if (!body.finalAmountCents || body.finalAmountCents <= 0) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "finalAmountCents is required and must be positive",
        },
      },
      400,
    );
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  if (order.status !== "invoiced") {
    return c.json(
      { error: { code: "BAD_REQUEST", message: `Order is '${order.status}', not 'invoiced'` } },
      400,
    );
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
  const authUser = c.get("authUser");
  const actor = authUser.email ?? "admin";

  const capturedAmount = body.finalAmountCents;

  try {
    if (body.finalAmountCents <= (order.preauthAmountCents ?? 0)) {
      // Capture within pre-auth amount
      await stripe.paymentIntents.capture(order.stripePaymentIntentId, {
        amount_to_capture: body.finalAmountCents,
      });
    } else {
      // Final amount exceeds pre-auth — cancel original and create new charge
      const originalPi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);
      await stripe.paymentIntents.cancel(order.stripePaymentIntentId);

      await stripe.paymentIntents.create({
        amount: body.finalAmountCents,
        currency: "usd",
        confirm: true,
        customer: originalPi.customer as string,
        payment_method: originalPi.payment_method as string,
        metadata: { orderId: String(order.id) },
        off_session: true,
      });
    }
  } catch (err) {
    console.error(`[capture] Error capturing payment for order ${id}:`, err);
    return c.json(
      { error: { code: "PAYMENT_FAILED", message: "Failed to capture payment" } },
      402,
    );
  }

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const [updated] = await db
    .update(schema.orders)
    .set({
      status: "paid",
      capturedAmountCents: capturedAmount,
      statusHistory: [
        ...history,
        { status: "paid", timestamp: new Date().toISOString(), actor },
      ],
      updatedAt: new Date(),
    })
    .where(and(eq(schema.orders.id, id), eq(schema.orders.status, "invoiced")))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "CONFLICT", message: "Order status changed concurrently" } },
      409,
    );
  }

  await logOrderEvent(id, "status_change", actor, {
    fromStatus: "invoiced",
    toStatus: "paid",
    metadata: { capturedAmountCents: capturedAmount, requestedAmountCents: body.finalAmountCents },
  });

  notifyOrderStatusChange(id, "paid");
  return c.json({ success: true, capturedAmountCents: capturedAmount });
});

// PATCH /orders/:id/notes — update admin notes
orders.patch("/:id/notes", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const body = await c.req.json<{ notes: string }>();

  const [updated] = await db
    .update(schema.orders)
    .set({ adminNotes: body.notes, updatedAt: new Date() })
    .where(eq(schema.orders.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  return c.json(updated);
});

export { orders };

// Public order PDF route (token-based, no admin auth required)
const ordersPdf = new Hono();

ordersPdf.get("/:id/pdf", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const token = c.req.query("token");

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(
      token
        ? and(eq(schema.orders.id, id), eq(schema.orders.shareToken, token))
        : eq(schema.orders.id, id),
    )
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  const customer = {
    name: order.contactName,
    phone: order.contactPhone,
    email: order.contactEmail,
    address: order.contactAddress,
    vehicleInfo: order.vehicleInfo as { make?: string; model?: string; year?: string } | null,
  };

  const items =
    ((order.items ?? []) as { name: string; description?: string; totalCents: number }[]).map(
      (i) => ({
        name: i.name,
        description: i.description ?? "",
        price: i.totalCents ?? 0,
      }),
    );

  const pdfStream = await renderToStream(
    EstimatePdf({
      estimate: {
        id,
        items,
        subtotal: order.subtotalCents ?? 0,
        priceRangeLow: order.priceRangeLowCents ?? 0,
        priceRangeHigh: order.priceRangeHighCents ?? 0,
        notes: order.notes,
        expiresAt: order.expiresAt ?? new Date(),
        createdAt: order.createdAt,
      },
      customer,
    }),
  );

  return new Response(pdfStream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="HMLS-Estimate-${id}.pdf"`,
    },
  });
});

export { ordersPdf };
