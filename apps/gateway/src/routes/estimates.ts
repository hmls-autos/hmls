import { Hono } from "hono";
import { renderToStream } from "@react-pdf/renderer";
import { db, schema } from "@hmls/agent/db";
import { and, eq } from "drizzle-orm";
import { EstimatePdf, notifyOrderStatusChange } from "@hmls/agent";
import { Errors } from "@hmls/shared/errors";
import { type AuthEnv, requireAuth } from "../middleware/auth.ts";

// After Layer 3 "estimate" is a VIEW on the `orders` table — there is no
// separate `estimates` table anymore. The routes below still live under
// `/estimates/:id` for URL compat but the :id parameter is an order ID.

const estimates = new Hono<AuthEnv>();

// GET /estimates/:id — authenticated owner view of an order
estimates.get("/:id", requireAuth, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const customerId = c.get("customerId");
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  if (!order) throw Errors.notFound("Order", id);
  if (order.customerId !== customerId) {
    return c.json(
      { error: { code: "FORBIDDEN", message: "Not authorized to view this order" } },
      403,
    );
  }

  return c.json(order);
});

// GET /estimates/:id/pdf — public via share token, or authenticated owner
estimates.get("/:id/pdf", async (c) => {
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

  if (!order) throw Errors.notFound("Order", id);

  const customer = {
    name: order.contactName,
    phone: order.contactPhone,
    email: order.contactEmail,
    address: order.contactAddress,
    vehicleInfo: order.vehicleInfo as
      | { make?: string; model?: string; year?: string }
      | null,
  };

  const items = (order.items as { name: string; description?: string; totalCents: number }[])
    .map((i) => ({
      name: i.name,
      description: i.description ?? "",
      price: i.totalCents ?? 0,
    }));

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

// GET /estimates/:id/review — public review page via share token
estimates.get("/:id/review", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Token required" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, id), eq(schema.orders.shareToken, token)))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }

  return c.json({
    estimate: {
      id,
      items: order.items,
      subtotal: order.subtotalCents,
      priceRangeLow: order.priceRangeLowCents,
      priceRangeHigh: order.priceRangeHighCents,
      vehicleInfo: order.vehicleInfo,
      notes: order.notes,
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
    },
    customerName: order.contactName,
    orderId: order.id,
    orderStatus: order.status,
  });
});

// POST /estimates/:id/approve — customer approves via share token
estimates.post("/:id/approve", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Token required" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, id), eq(schema.orders.shareToken, token)))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }
  if (order.status !== "estimated") {
    return c.json(
      { error: { code: "BAD_REQUEST", message: `Order is already '${order.status}'` } },
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
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "estimated")))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "CONFLICT", message: "Order status changed concurrently" } },
      409,
    );
  }

  await db.insert(schema.orderEvents).values({
    orderId: order.id,
    eventType: "status_change",
    fromStatus: "estimated",
    toStatus: "approved",
    actor: "customer",
    metadata: {},
  });

  notifyOrderStatusChange(order.id, "approved");
  return c.json({ success: true, order: updated });
});

// POST /estimates/:id/decline — customer declines via share token
estimates.post("/:id/decline", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid order ID" } }, 400);
  }

  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Token required" } }, 400);
  }

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, id), eq(schema.orders.shareToken, token)))
    .limit(1);

  if (!order) {
    return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
  }
  if (order.status !== "estimated") {
    return c.json(
      { error: { code: "BAD_REQUEST", message: `Order is already '${order.status}'` } },
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
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "estimated")))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "CONFLICT", message: "Order status changed concurrently" } },
      409,
    );
  }

  await db.insert(schema.orderEvents).values({
    orderId: order.id,
    eventType: "status_change",
    fromStatus: "estimated",
    toStatus: "declined",
    actor: "customer",
    metadata: {},
  });

  notifyOrderStatusChange(order.id, "declined");
  return c.json({ success: true, order: updated });
});

export { estimates };
