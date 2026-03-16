import { Hono } from "hono";
import { renderToStream } from "@react-pdf/renderer";
import { db, schema } from "@hmls/agent/db";
import { and, eq } from "drizzle-orm";
import { EstimatePdf, notifyOrderStatusChange } from "@hmls/agent";
import { Errors } from "@hmls/shared/errors";
import { type AuthEnv, requireAuth } from "../middleware/auth.ts";

const estimates = new Hono<AuthEnv>();

// GET estimate by ID (authenticated, owner-only)
estimates.get("/:id", requireAuth, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } }, 400);
  }

  const customerId = c.get("customerId");
  const [estimate] = await db
    .select()
    .from(schema.estimates)
    .where(eq(schema.estimates.id, id))
    .limit(1);

  if (!estimate) throw Errors.notFound("Estimate", id);

  if (estimate.customerId !== customerId) {
    return c.json(
      { error: { code: "FORBIDDEN", message: "Not authorized to view this estimate" } },
      403,
    );
  }

  return c.json(estimate);
});

// GET estimate PDF (share-token for public access, or authenticated owner)
estimates.get("/:id/pdf", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } }, 400);
  }

  const token = c.req.query("token");

  // Try to read from orders first (new flow), fall back to estimates
  const [orderRow] = await db
    .select({
      order: schema.orders,
      customerName: schema.customers.name,
      customerPhone: schema.customers.phone,
      customerEmail: schema.customers.email,
      customerAddress: schema.customers.address,
    })
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .where(
      token
        ? and(eq(schema.orders.estimateId, id), eq(schema.orders.shareToken, token))
        : eq(schema.orders.estimateId, id),
    )
    .limit(1);

  if (orderRow && orderRow.order.items && (orderRow.order.items as unknown[]).length > 0) {
    // Use order items (new format)
    const order = orderRow.order;
    const customer = {
      name: orderRow.customerName,
      phone: orderRow.customerPhone,
      email: orderRow.customerEmail,
      address: orderRow.customerAddress,
      vehicleInfo: order.vehicleInfo as { make?: string; model?: string; year?: string } | null,
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
  }

  // Fall back to estimates table (legacy)
  const [row] = await db
    .select({
      estimate: schema.estimates,
      customerName: schema.customers.name,
      customerPhone: schema.customers.phone,
      customerEmail: schema.customers.email,
      customerAddress: schema.customers.address,
    })
    .from(schema.estimates)
    .leftJoin(schema.customers, eq(schema.estimates.customerId, schema.customers.id))
    .where(
      token
        ? and(eq(schema.estimates.id, id), eq(schema.estimates.shareToken, token))
        : eq(schema.estimates.id, id),
    )
    .limit(1);

  if (!row) throw Errors.notFound("Estimate", id);

  const estimate = row.estimate;
  const customer = {
    name: row.customerName,
    phone: row.customerPhone,
    email: row.customerEmail,
    address: row.customerAddress,
    vehicleInfo: estimate.vehicleInfo as { make?: string; model?: string; year?: string } | null,
  };

  const pdfStream = await renderToStream(
    EstimatePdf({
      estimate: {
        ...estimate,
        items: estimate.items as { name: string; description: string; price: number }[],
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

// --- Public token-based routes ---

// GET estimate review data by share token — reads from orders table
estimates.get("/:id/review", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } }, 400);
  }

  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Token required" } }, 400);
  }

  // Try orders table first (new flow)
  const [orderRow] = await db
    .select({
      order: schema.orders,
      customerName: schema.customers.name,
      customerEmail: schema.customers.email,
    })
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .where(and(eq(schema.orders.estimateId, id), eq(schema.orders.shareToken, token)))
    .limit(1);

  if (orderRow) {
    const order = orderRow.order;
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
      customerName: orderRow.customerName,
      orderId: order.id,
      orderStatus: order.status,
    });
  }

  // Fall back to estimates table (legacy)
  const [row] = await db
    .select({
      estimate: schema.estimates,
      customerName: schema.customers.name,
      customerEmail: schema.customers.email,
      orderId: schema.orders.id,
      orderStatus: schema.orders.status,
    })
    .from(schema.estimates)
    .leftJoin(schema.customers, eq(schema.estimates.customerId, schema.customers.id))
    .leftJoin(schema.orders, eq(schema.orders.estimateId, schema.estimates.id))
    .where(and(eq(schema.estimates.id, id), eq(schema.estimates.shareToken, token)))
    .limit(1);

  if (!row) {
    return c.json({ error: { code: "NOT_FOUND", message: "Estimate not found" } }, 404);
  }

  return c.json({
    estimate: {
      id: row.estimate.id,
      items: row.estimate.items,
      subtotal: row.estimate.subtotal,
      priceRangeLow: row.estimate.priceRangeLow,
      priceRangeHigh: row.estimate.priceRangeHigh,
      vehicleInfo: row.estimate.vehicleInfo,
      notes: row.estimate.notes,
      expiresAt: row.estimate.expiresAt,
      createdAt: row.estimate.createdAt,
    },
    customerName: row.customerName,
    orderId: row.orderId,
    orderStatus: row.orderStatus,
  });
});

// POST approve estimate by share token — uses new status machine
estimates.post("/:id/approve", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } }, 400);
  }

  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Token required" } }, 400);
  }

  // Find order by share token
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.estimateId, id), eq(schema.orders.shareToken, token)))
    .limit(1);

  if (!order) {
    // Fall back: try via estimates table
    const [estimate] = await db
      .select()
      .from(schema.estimates)
      .where(and(eq(schema.estimates.id, id), eq(schema.estimates.shareToken, token)))
      .limit(1);
    if (!estimate) {
      return c.json({ error: { code: "NOT_FOUND", message: "Estimate not found" } }, 404);
    }
    const [linkedOrder] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.estimateId, id))
      .limit(1);
    if (!linkedOrder) {
      return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
    }
    // Use the linked order
    return doApprove(c, linkedOrder);
  }

  return doApprove(c, order);
});

async function doApprove(
  c: { json: (data: unknown, status?: number) => Response },
  order: typeof schema.orders.$inferSelect,
) {
  if (order.status !== "sent") {
    return c.json(
      { error: { code: "BAD_REQUEST", message: `Order is already '${order.status}'` } },
      400,
    );
  }

  // Atomic transition
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
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "sent")))
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
    fromStatus: "sent",
    toStatus: "approved",
    actor: "customer",
    metadata: {},
  });

  notifyOrderStatusChange(order.id, "approved");
  return c.json({ success: true, order: updated });
}

// POST decline estimate by share token — uses new status machine
estimates.post("/:id/decline", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } }, 400);
  }

  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Token required" } }, 400);
  }

  // Find order by share token
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.estimateId, id), eq(schema.orders.shareToken, token)))
    .limit(1);

  if (!order) {
    // Fall back: try via estimates table
    const [estimate] = await db
      .select()
      .from(schema.estimates)
      .where(and(eq(schema.estimates.id, id), eq(schema.estimates.shareToken, token)))
      .limit(1);
    if (!estimate) {
      return c.json({ error: { code: "NOT_FOUND", message: "Estimate not found" } }, 404);
    }
    const [linkedOrder] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.estimateId, id))
      .limit(1);
    if (!linkedOrder) {
      return c.json({ error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
    }
    return doDecline(c, linkedOrder);
  }

  return doDecline(c, order);
});

async function doDecline(
  c: { req: { json: <T>() => Promise<T> }; json: (data: unknown, status?: number) => Response },
  order: typeof schema.orders.$inferSelect,
) {
  if (order.status !== "sent") {
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
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "sent")))
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
    fromStatus: "sent",
    toStatus: "declined",
    actor: "customer",
    metadata: {},
  });

  notifyOrderStatusChange(order.id, "declined");
  return c.json({ success: true, order: updated });
}

export { estimates };
