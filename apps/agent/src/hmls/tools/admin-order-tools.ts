import { z } from "zod";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.ts";
import type { OrderItem } from "../../db/schema.ts";
import { toolResult } from "@hmls/shared/tool-result";

// ---------------------------------------------------------------------------
// Tool 1: list_orders
// ---------------------------------------------------------------------------

const listOrdersTool = {
  name: "list_orders",
  description: "List all orders with optional status filter. Returns id, status, customer name, " +
    "vehicle info, total, and created date. Use to browse the order queue or find orders " +
    "by status (e.g. 'draft', 'sent', 'in_progress').",
  schema: z.object({
    status: z
      .string()
      .optional()
      .describe(
        "Filter by order status (e.g. 'draft', 'sent', 'approved', 'in_progress'). Omit to list all.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Max number of orders to return (default 50, max 100)"),
  }),
  execute: async (
    params: { status?: string; limit?: number },
    _ctx: unknown,
  ) => {
    const limit = Math.min(params.limit ?? 50, 100);

    let query = db
      .select()
      .from(schema.orders)
      .orderBy(desc(schema.orders.createdAt))
      .$dynamic();

    if (params.status) {
      query = query.where(eq(schema.orders.status, params.status));
    }

    const rows = await query.limit(limit);

    const orders = rows.map((o) => ({
      id: o.id,
      status: o.status,
      customerName: o.contactName ?? null,
      vehicleInfo: o.vehicleInfo
        ? (() => {
          const v = o.vehicleInfo as { year?: string; make?: string; model?: string };
          return [v.year, v.make, v.model].filter(Boolean).join(" ") || null;
        })()
        : null,
      subtotalFormatted: `$${((o.subtotalCents ?? 0) / 100).toFixed(2)}`,
      subtotalCents: o.subtotalCents ?? 0,
      createdAt: o.createdAt,
    }));

    return toolResult({
      success: true,
      total: orders.length,
      orders,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 2: search_customers
// ---------------------------------------------------------------------------

const searchCustomersTool = {
  name: "search_customers",
  description: "Find customers by name, email, or phone number. Returns matching customers with " +
    "id, name, email, phone, and address. Use before create_order to look up a customer ID.",
  schema: z.object({
    query: z
      .string()
      .min(1)
      .describe("Search term — matches against customer name, email, or phone"),
  }),
  execute: async (params: { query: string }, _ctx: unknown) => {
    const term = `%${params.query}%`;

    const rows = await db
      .select()
      .from(schema.customers)
      .where(
        or(
          ilike(schema.customers.name, term),
          ilike(schema.customers.email, term),
          ilike(schema.customers.phone, term),
        ),
      )
      .orderBy(desc(schema.customers.createdAt))
      .limit(20);

    const customers = rows.map((c) => ({
      id: c.id,
      name: c.name ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      address: c.address ?? null,
      vehicleInfo: c.vehicleInfo ?? null,
      createdAt: c.createdAt,
    }));

    return toolResult({
      success: true,
      total: customers.length,
      customers,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 3: create_order
// ---------------------------------------------------------------------------

const createOrderTool = {
  name: "create_order",
  description:
    "Create a new draft order for a customer. Use search_customers to find the customer_id first. " +
    "Optionally include vehicle info and line items. Returns the new order id and status.",
  schema: z.object({
    customer_id: z
      .string()
      .describe("Customer ID (numeric string or number)"),
    vehicle_year: z
      .number()
      .int()
      .optional()
      .describe("Vehicle year, e.g. 2019"),
    vehicle_make: z
      .string()
      .optional()
      .describe("Vehicle make, e.g. 'Ford'"),
    vehicle_model: z
      .string()
      .optional()
      .describe("Vehicle model, e.g. 'F-150'"),
    description: z
      .string()
      .optional()
      .describe("General description / notes for the order"),
    items: z
      .array(
        z.object({
          description: z.string().describe("Line item description"),
          labor_hours: z.number().optional().describe("Labor hours for this item"),
          parts_cost: z.number().optional().describe("Parts cost in dollars"),
        }),
      )
      .optional()
      .describe("Line items to add to the order"),
  }),
  execute: async (
    params: {
      customer_id: string;
      vehicle_year?: number;
      vehicle_make?: string;
      vehicle_model?: string;
      description?: string;
      items?: Array<{ description: string; labor_hours?: number; parts_cost?: number }>;
    },
    _ctx: unknown,
  ) => {
    const customerId = Number(params.customer_id);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return toolResult({ success: false, error: "Invalid customer_id" });
    }

    // Verify customer exists
    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1);

    if (!customer) {
      return toolResult({ success: false, error: `Customer #${customerId} not found` });
    }

    // Build vehicle info if provided
    const vehicleInfo = (params.vehicle_year || params.vehicle_make || params.vehicle_model)
      ? {
        year: params.vehicle_year ? String(params.vehicle_year) : undefined,
        make: params.vehicle_make ?? undefined,
        model: params.vehicle_model ?? undefined,
      }
      : null;

    // Build OrderItem[] from simple items input
    const orderItems: OrderItem[] = (params.items ?? []).map((item) => {
      const laborCents = Math.round((item.labor_hours ?? 0) * 120 * 100); // $120/hr default
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

    const [order] = await db
      .insert(schema.orders)
      .values({
        customerId,
        status: "draft",
        statusHistory: [
          { status: "draft", timestamp: new Date().toISOString(), actor: "agent" },
        ],
        items: orderItems,
        notes: params.description ?? null,
        subtotalCents,
        priceRangeLowCents: Math.round(subtotalCents * 0.9),
        priceRangeHighCents: Math.round(subtotalCents * 1.1),
        vehicleInfo: vehicleInfo ?? undefined,
        contactName: customer.name ?? null,
        contactEmail: customer.email ?? null,
        contactPhone: customer.phone ?? null,
        contactAddress: customer.address ?? null,
      })
      .returning();

    // Audit event
    await db.insert(schema.orderEvents).values({
      orderId: order.id,
      eventType: "status_change",
      fromStatus: null,
      toStatus: "draft",
      actor: "agent",
      metadata: {
        itemCount: orderItems.length,
        ...(vehicleInfo ? { vehicleInfo } : {}),
      },
    });

    return toolResult({
      success: true,
      orderId: order.id,
      status: order.status,
      customerName: customer.name ?? null,
      vehicleInfo: vehicleInfo
        ? [vehicleInfo.year, vehicleInfo.make, vehicleInfo.model].filter(Boolean).join(" ")
        : null,
      subtotalFormatted: `$${(subtotalCents / 100).toFixed(2)}`,
      message: `Draft order #${order.id} created for ${customer.name ?? `customer #${customerId}`}`,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 4: update_order_items
// ---------------------------------------------------------------------------

const EDITABLE_STATUSES = new Set(["draft", "revised", "estimated"]);

const updateOrderItemsTool = {
  name: "update_order_items",
  description: "Update line items and/or notes on a draft, revised, or estimated order. " +
    "Only works on orders in 'draft', 'revised', or 'estimated' status. " +
    "Replaces the existing items array — include all items you want on the order. " +
    "Automatically recalculates total_amount (subtotal) from item unit_price * quantity.",
  schema: z.object({
    order_id: z
      .string()
      .describe("The order ID to update (numeric string or number)"),
    items: z
      .array(
        z.object({
          description: z.string().describe("Line item description"),
          labor_hours: z.number().optional().describe("Labor hours for this item"),
          parts_cost: z.number().optional().describe("Parts cost in dollars"),
        }),
      )
      .optional()
      .describe("Replacement items list. Omit to leave items unchanged."),
    notes: z
      .string()
      .optional()
      .describe("Updated notes for the order. Omit to leave notes unchanged."),
  }),
  execute: async (
    params: {
      order_id: string;
      items?: Array<{ description: string; labor_hours?: number; parts_cost?: number }>;
      notes?: string;
    },
    _ctx: unknown,
  ) => {
    const id = Number(params.order_id);
    if (!Number.isInteger(id) || id <= 0) {
      return toolResult({ success: false, error: "Invalid order_id" });
    }

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);

    if (!order) {
      return toolResult({ success: false, error: `Order #${id} not found` });
    }

    if (!EDITABLE_STATUSES.has(order.status)) {
      return toolResult({
        success: false,
        error:
          `Cannot edit order #${id} in '${order.status}' status. Editable statuses: draft, revised, estimated`,
      });
    }

    if (params.items === undefined && params.notes === undefined) {
      return toolResult({ success: false, error: "Provide at least one of: items, notes" });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (params.items !== undefined) {
      const orderItems: OrderItem[] = params.items.map((item) => {
        const laborCents = Math.round((item.labor_hours ?? 0) * 120 * 100); // $120/hr default
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
      updates.items = orderItems;
      updates.subtotalCents = subtotalCents;
      updates.priceRangeLowCents = Math.round(subtotalCents * 0.9);
      updates.priceRangeHighCents = Math.round(subtotalCents * 1.1);
    }

    if (params.notes !== undefined) {
      updates.notes = params.notes;
    }

    // Use optimistic concurrency — only update if status hasn't changed
    const [updated] = await db
      .update(schema.orders)
      .set(updates)
      .where(
        sql`${schema.orders.id} = ${id} AND ${schema.orders.status} = ${order.status}`,
      )
      .returning();

    if (!updated) {
      return toolResult({
        success: false,
        error: "Order status changed concurrently — refresh and retry",
      });
    }

    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "items_edited",
      actor: "agent",
      metadata: {
        itemCount: Array.isArray(updated.items) ? (updated.items as unknown[]).length : 0,
      },
    });

    return toolResult({
      success: true,
      orderId: updated.id,
      status: updated.status,
      subtotalFormatted: `$${((updated.subtotalCents ?? 0) / 100).toFixed(2)}`,
      itemCount: Array.isArray(updated.items) ? (updated.items as unknown[]).length : 0,
      notes: updated.notes,
      message: `Order #${id} updated`,
    });
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const adminOrderTools = [
  listOrdersTool,
  searchCustomersTool,
  createOrderTool,
  updateOrderItemsTool,
];
