import { Hono } from "hono";
import { db, schema } from "@hmls/agent/db";
import { and, desc, eq } from "drizzle-orm";
import { type AdminEnv, requireAdmin } from "../middleware/admin.ts";
import { notifyOrderStatusChange } from "@hmls/agent";
import type { OrderItem } from "@hmls/agent/db";

// New status machine
const TRANSITIONS: Record<string, string[]> = {
  draft: ["estimated", "cancelled"],
  estimated: ["sent", "cancelled"],
  sent: ["approved", "declined", "cancelled"],
  approved: ["invoiced", "cancelled"],
  declined: ["revised"],
  revised: ["sent", "cancelled"],
  invoiced: ["paid", "void", "cancelled"],
  paid: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: ["archived"],
  // terminal
  archived: [],
  cancelled: [],
  void: [],
};

// Editable statuses
const EDITABLE_STATUSES = new Set(["draft", "estimated", "revised"]);

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

// GET /orders — list all orders
orders.get("/", async (c) => {
  const status = c.req.query("status");
  let query = db
    .select()
    .from(schema.orders)
    .orderBy(desc(schema.orders.createdAt))
    .$dynamic();

  if (status) {
    query = query.where(eq(schema.orders.status, status));
  }

  const rows = await query.limit(200);
  return c.json(rows);
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

// POST /orders/:id/send — transition to 'sent' + trigger notification
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

  const validFrom = ["estimated", "revised"];
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
      status: "sent",
      statusHistory: [
        ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
        { status: "sent", timestamp: new Date().toISOString(), actor },
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

  await logOrderEvent(id, "status_change", actor, { fromStatus: order.status, toStatus: "sent" });
  notifyOrderStatusChange(id, "sent");

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
