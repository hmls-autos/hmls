import { Hono } from "hono";
import { db, schema } from "@hmls/agent/db";
import { desc, eq } from "drizzle-orm";
import { type AdminEnv, requireAdmin } from "../middleware/admin.ts";
import { notifyOrderStatusChange } from "@hmls/agent";

// Valid status transitions
const TRANSITIONS: Record<string, string[]> = {
  estimated: ["customer_approved", "customer_declined", "cancelled"],
  customer_approved: ["quoted", "cancelled"],
  quoted: ["accepted", "declined", "cancelled"],
  accepted: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  // Terminal states — no transitions out
  customer_declined: [],
  declined: [],
  completed: [],
  cancelled: [],
};

function appendStatusHistory(
  current: unknown[],
  newStatus: string,
  actor: string,
): unknown[] {
  return [
    ...(Array.isArray(current) ? current : []),
    { status: newStatus, timestamp: new Date().toISOString(), actor },
  ];
}

const orders = new Hono<AdminEnv>();

// All order admin routes require admin role
orders.use("*", requireAdmin);

// GET /orders — list all orders with customer info
orders.get("/", async (c) => {
  const status = c.req.query("status");
  let query = db
    .select({
      order: schema.orders,
      customerName: schema.customers.name,
      customerEmail: schema.customers.email,
      customerPhone: schema.customers.phone,
    })
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .orderBy(desc(schema.orders.createdAt))
    .$dynamic();

  if (status) {
    query = query.where(eq(schema.orders.status, status));
  }

  const rows = await query.limit(200);
  return c.json(
    rows.map((r) => ({
      ...r.order,
      customer: {
        name: r.customerName,
        email: r.customerEmail,
        phone: r.customerPhone,
      },
    })),
  );
});

// GET /orders/:id — single order with related entities
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

  // Fetch related entities in parallel
  const [customer, estimate, quote, booking] = await Promise.all([
    db.select().from(schema.customers).where(eq(schema.customers.id, order.customerId)).limit(1)
      .then((r) => r[0]),
    order.estimateId
      ? db.select().from(schema.estimates).where(eq(schema.estimates.id, order.estimateId)).limit(1)
        .then((r) => r[0])
      : null,
    order.quoteId
      ? db.select().from(schema.quotes).where(eq(schema.quotes.id, order.quoteId)).limit(1).then((
        r,
      ) => r[0])
      : null,
    order.bookingId
      ? db.select().from(schema.bookings).where(eq(schema.bookings.id, order.bookingId)).limit(1)
        .then((r) => r[0])
      : null,
  ]);

  return c.json({ order, customer, estimate, quote, booking });
});

// PATCH /orders/:id/status — transition order status
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
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: `Cannot transition from '${order.status}' to '${newStatus}'. Allowed: ${
            allowed.join(", ") || "none (terminal state)"
          }`,
        },
      },
      400,
    );
  }

  const authUser = c.get("authUser");
  const updates: Record<string, unknown> = {
    status: newStatus,
    statusHistory: appendStatusHistory(
      order.statusHistory as unknown[],
      newStatus,
      authUser.email ?? "admin",
    ),
    updatedAt: new Date(),
  };

  if (body.notes) updates.adminNotes = body.notes;
  if (newStatus === "cancelled" && body.cancellationReason) {
    updates.cancellationReason = body.cancellationReason;
  }

  const [updated] = await db
    .update(schema.orders)
    .set(updates)
    .where(eq(schema.orders.id, id))
    .returning();

  // Fire-and-forget notification
  notifyOrderStatusChange(id, newStatus);

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
