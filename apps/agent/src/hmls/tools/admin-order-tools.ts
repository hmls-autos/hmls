import { z } from "zod";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.ts";
import type { OrderItem } from "../../db/schema.ts";
import { toolResult } from "@hmls/shared/tool-result";
import type { LaborTimeResult, OlpVehicle } from "./olp-client.ts";

// ---------------------------------------------------------------------------
// Tool 1: list_orders
// ---------------------------------------------------------------------------

const listOrdersTool = {
  name: "list_orders",
  description: "List all orders with optional status filter. Returns id, status, customer name, " +
    "vehicle info, total, and created date. Use to browse the order queue or find orders " +
    "by status (e.g. 'draft', 'estimated', 'in_progress').",
  schema: z.object({
    status: z
      .string()
      .optional()
      .describe(
        "Filter by order status (e.g. 'draft', 'estimated', 'approved', 'in_progress'). Omit to list all.",
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
    "Create a new draft order. All customer fields are optional — you can create an order with zero customer info. " +
    "If customer_id is given, uses that customer. If customer_email is given, looks up or creates a customer. " +
    "If only name/phone, creates a guest customer. If nothing is provided, creates an anonymous customer. " +
    "Optionally include vehicle info and line items. Returns the new order id and status.",
  schema: z.object({
    customer_id: z
      .string()
      .optional()
      .describe(
        "Existing customer ID. If omitted, a customer is found or created from other fields (all optional).",
      ),
    customer_name: z
      .string()
      .optional()
      .describe("Customer name (used to create/find customer if no customer_id)"),
    customer_email: z
      .string()
      .optional()
      .describe("Customer email (used to look up existing customer or create new one)"),
    customer_phone: z
      .string()
      .optional()
      .describe("Customer phone number"),
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
          description: z.string().describe(
            "Line item description (e.g., 'Front brake pad replacement')",
          ),
          labor_hours: z.number().optional().describe(
            "Labor hours for this item (optional — will auto-lookup if omitted)",
          ),
          parts_cost: z.number().optional().describe(
            "Parts cost in dollars (optional — defaults to $0)",
          ),
        }),
      )
      .min(1, "At least one item is required to create an order")
      .describe("Line items to add to the order (required)"),
  }),
  execute: async (
    params: {
      customer_id?: string;
      customer_name?: string;
      customer_email?: string;
      customer_phone?: string;
      vehicle_year?: number;
      vehicle_make?: string;
      vehicle_model?: string;
      description?: string;
      items?: Array<{ description: string; labor_hours?: number; parts_cost?: number }>;
    },
    _ctx: unknown,
  ) => {
    let customer: {
      id: number;
      name: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
    } | null = null;

    if (params.customer_id) {
      // Existing customer by ID
      const customerId = Number(params.customer_id);
      if (!Number.isInteger(customerId) || customerId <= 0) {
        return toolResult({ success: false, error: "Invalid customer_id" });
      }
      const [found] = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, customerId))
        .limit(1);
      if (!found) {
        return toolResult({ success: false, error: `Customer #${customerId} not found` });
      }
      customer = found;
    } else if (params.customer_name || params.customer_email || params.customer_phone) {
      // Try to find by email first
      if (params.customer_email) {
        const [existing] = await db
          .select()
          .from(schema.customers)
          .where(ilike(schema.customers.email, params.customer_email))
          .limit(1);
        if (existing) {
          customer = existing;
        } else {
          // Create new customer
          const [created] = await db
            .insert(schema.customers)
            .values({
              name: params.customer_name || null,
              email: params.customer_email,
              phone: params.customer_phone || null,
            })
            .returning();
          customer = created;
        }
      } else {
        // No email — create guest customer with name/phone
        const [created] = await db
          .insert(schema.customers)
          .values({
            name: params.customer_name || null,
            email: null,
            phone: params.customer_phone || null,
          })
          .returning();
        customer = created;
      }
    }
    // No customer info at all → order created without a customer link

    // Build vehicle info if provided
    const vehicleInfo = (params.vehicle_year || params.vehicle_make || params.vehicle_model)
      ? {
        year: params.vehicle_year ? String(params.vehicle_year) : undefined,
        make: params.vehicle_make ?? undefined,
        model: params.vehicle_model ?? undefined,
      }
      : null;

    // Auto-lookup labor hours if not provided and vehicle info available
    const itemsForOrder: Array<{
      description: string;
      labor_hours: number;
      parts_cost?: number;
      sourceMeta?: LaborTimeResult["sourceMeta"];
    }> = [];

    for (const item of params.items ?? []) {
      let laborHours = item.labor_hours;
      let sourceMeta: LaborTimeResult["sourceMeta"] | undefined;

      // Auto-lookup labor time if not provided and we have vehicle info
      if (
        laborHours === undefined && vehicleInfo?.year && vehicleInfo?.make && vehicleInfo?.model
      ) {
        try {
          const { searchLaborTimes, findVehicles } = await import("./olp-client.ts");
          const vehicles = await findVehicles(
            vehicleInfo.make,
            vehicleInfo.model,
            Number(vehicleInfo.year),
          );

          if (vehicles.length > 0) {
            const serviceWords = item.description
              .split(/\s+/)
              .filter((w) => w.length > 1);

            const laborTimes = await searchLaborTimes(
              vehicles.map((v: OlpVehicle) => v.id),
              serviceWords,
              undefined, // category
            );

            if (laborTimes.length > 0) {
              laborHours = Number(laborTimes[0].labor_hours);
              sourceMeta = laborTimes[0].sourceMeta;
            }
          }
        } catch (_e) {
          // Fallback: leave labor_hours as 0
          laborHours = 0;
        }
      }

      itemsForOrder.push({
        description: item.description,
        labor_hours: laborHours ?? 0,
        parts_cost: item.parts_cost,
        ...(sourceMeta ? { sourceMeta } : {}),
      });
    }

    if (itemsForOrder.length === 0) {
      return toolResult({
        success: false,
        error:
          "At least one line item is required. Describe the service (e.g., 'Front brake pad replacement') and include vehicle year/make/model for auto labor lookup.",
      });
    }

    const orderItems: OrderItem[] = itemsForOrder.map((item) => {
      const laborCents = Math.round(item.labor_hours * 140 * 100); // $140/hr
      const partsCents = Math.round((item.parts_cost ?? 0) * 100);
      const totalCents = laborCents + partsCents;
      const meta: Record<string, unknown> = {};
      if (item.sourceMeta) meta.sourceMeta = item.sourceMeta;
      return {
        id: crypto.randomUUID(),
        category: "labor" as const,
        name: item.description,
        quantity: 1,
        unitPriceCents: totalCents,
        totalCents,
        taxable: true,
        ...(item.labor_hours > 0 ? { laborHours: item.labor_hours } : {}),
        ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
      };
    });

    const subtotalCents = orderItems.reduce((sum, i) => sum + i.totalCents, 0);

    const [order] = await db
      .insert(schema.orders)
      .values({
        customerId: customer?.id ?? null,
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
        contactName: customer?.name ?? null,
        contactEmail: customer?.email ?? null,
        contactPhone: customer?.phone ?? null,
        contactAddress: customer?.address ?? null,
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
      customerName: customer?.name ?? null,
      vehicleInfo: vehicleInfo
        ? [vehicleInfo.year, vehicleInfo.make, vehicleInfo.model].filter(Boolean).join(" ")
        : null,
      subtotalFormatted: `$${(subtotalCents / 100).toFixed(2)}`,
      message: `Draft order #${order.id} created${customer?.name ? ` for ${customer.name}` : ""}`,
    });
  },
};
// ---------------------------------------------------------------------------
// Tool 4: update_order_items -- PATCH mode with stable item IDs
// ---------------------------------------------------------------------------

const EDITABLE_STATUSES = new Set(["draft", "revised", "estimated"]);

// In-memory idempotency set (production: use Redis or DB)
const executedKeys = new Set<string>();

const updateOrderItemsTool = {
  name: "update_order_items",
  description: "Update line items on a draft, revised, or estimated order using PATCH semantics. " +
    "Only works on orders in 'draft', 'revised', or 'estimated' status. " +
    "Operations: add new items, update existing by itemId, or remove by itemId. " +
    "Use idempotencyKey to prevent duplicate operations on retry. " +
    "ExpectedVersion ensures no concurrent-overwrite conflicts.",
  schema: z.object({
    order_id: z
      .string()
      .describe("The order ID to update (numeric string or number)"),
    // PATCH operations
    addItems: z
      .array(
        z.object({
          itemId: z
            .string()
            .optional()
            .describe("Optional stable item ID. Auto-generated if omitted."),
          description: z
            .string()
            .describe("Line item description (e.g., 'Front brake pad replacement')"),
          labor_hours: z
            .number()
            .optional()
            .describe("Labor hours (optional — auto-lookup if omitted and vehicle known)"),
          parts_cost: z
            .number()
            .optional()
            .describe("Parts cost in dollars (optional — defaults to $0)"),
          intent: z
            .enum(["replace", "inspect", "optional", "note"])
            .default("replace")
            .describe("Service intent: replace=正式施工, inspect=检查, optional=可选项, note=备注"),
        }),
      )
      .optional()
      .describe("Items to add to the order"),
    updateItems: z
      .array(
        z.object({
          itemId: z.string().describe("Existing item ID to update"),
          description: z.string().optional().describe("New description"),
          labor_hours: z.number().optional().describe("New labor hours"),
          parts_cost: z.number().optional().describe("New parts cost"),
          intent: z
            .enum(["replace", "inspect", "optional", "note"])
            .optional()
            .describe("New service intent"),
        }),
      )
      .optional()
      .describe("Items to update by itemId"),
    removeItemIds: z
      .array(z.string())
      .optional()
      .describe("Item IDs to remove from the order"),
    // Safety
    expectedVersion: z
      .number()
      .int()
      .optional()
      .describe("Expected revisionNumber for optimistic concurrency (optional)"),
    idempotencyKey: z
      .string()
      .optional()
      .describe("Unique key to prevent duplicate execution (e.g., 'req-123')"),
    notes: z
      .string()
      .optional()
      .describe("Updated notes for the order"),
  }),
  execute: async (
    params: {
      order_id: string;
      addItems?: Array<{
        itemId?: string;
        description: string;
        labor_hours?: number;
        parts_cost?: number;
        intent?: "replace" | "inspect" | "optional" | "note";
      }>;
      updateItems?: Array<{
        itemId: string;
        description?: string;
        labor_hours?: number;
        parts_cost?: number;
        intent?: "replace" | "inspect" | "optional" | "note";
      }>;
      removeItemIds?: string[];
      expectedVersion?: number;
      idempotencyKey?: string;
      notes?: string;
    },
    _ctx: unknown,
  ) => {
    const id = Number(params.order_id);
    if (!Number.isInteger(id) || id <= 0) {
      return toolResult({ success: false, error: "Invalid order_id" });
    }

    // Idempotency check
    if (params.idempotencyKey) {
      if (executedKeys.has(params.idempotencyKey)) {
        return toolResult({
          success: true,
          orderId: id,
          message: "Already processed (idempotency hit)",
          deduplicated: true,
        });
      }
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

    // Optimistic concurrency check
    const currentVersion = (order as unknown as { revisionNumber?: number }).revisionNumber ?? 0;
    if (params.expectedVersion !== undefined && params.expectedVersion !== currentVersion) {
      return toolResult({
        success: false,
        error:
          `Version mismatch: expected ${params.expectedVersion}, got ${currentVersion}. Refresh and retry.`,
        currentVersion,
      });
    }

    if (
      params.addItems === undefined &&
      params.updateItems === undefined &&
      params.removeItemIds === undefined &&
      params.notes === undefined
    ) {
      return toolResult({
        success: false,
        error: "Provide at least one of: addItems, updateItems, removeItemIds, notes",
      });
    }

    // Build working items map by itemId
    const existingItems: OrderItem[] = Array.isArray(order.items)
      ? (order.items as OrderItem[])
      : [];
    const itemsMap = new Map<string, OrderItem>(
      existingItems.map((i) => [i.id, i]),
    );

    const vehicleInfo =
      (order as unknown as { vehicleInfo?: { year?: string; make?: string; model?: string } })
        .vehicleInfo;

    // Helper: build OrderItem from input
    async function buildItem(
      desc: string,
      laborHours?: number,
      partsCost?: number,
      intent: "replace" | "inspect" | "optional" | "note" = "replace",
      stableId?: string,
      sourceMeta?: LaborTimeResult["sourceMeta"],
    ): Promise<OrderItem> {
      let finalLabor = laborHours ?? 0;
      let resolvedSourceMeta = sourceMeta;

      // Auto-lookup labor time if not provided and vehicle info available
      if (finalLabor === 0 && vehicleInfo?.year && vehicleInfo?.make && vehicleInfo?.model) {
        try {
          const { searchLaborTimes, findVehicles } = await import("./olp-client.ts");
          const vehicles = await findVehicles(
            vehicleInfo.make,
            vehicleInfo.model,
            Number(vehicleInfo.year),
          );
          if (vehicles.length > 0) {
            const serviceWords = desc
              .split(/\s+/)
              .filter((w) => w.length > 1);
            const laborTimes = await searchLaborTimes(
              vehicles.map((v: OlpVehicle) => v.id),
              serviceWords,
              undefined,
            );
            if (laborTimes.length > 0) {
              finalLabor = Number(laborTimes[0].labor_hours);
              resolvedSourceMeta = laborTimes[0].sourceMeta;
            }
          }
        } catch (_e) {
          // Keep defaults
        }
      }

      const laborCents = Math.round(finalLabor * 140 * 100); // $140/hr
      const partsCents = Math.round((partsCost ?? 0) * 100);
      const totalCents = laborCents + partsCents;

      const metadata: Record<string, unknown> = {};
      if (intent) metadata.intent = intent;
      if (resolvedSourceMeta) metadata.sourceMeta = resolvedSourceMeta;

      return {
        id: stableId ?? crypto.randomUUID(),
        category: intent === "note" ? "fee" : "labor",
        name: desc,
        quantity: 1,
        unitPriceCents: totalCents,
        totalCents,
        taxable: intent !== "note",
        ...(finalLabor > 0 ? { laborHours: finalLabor } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
    }

    // 1. Apply removals
    if (params.removeItemIds && params.removeItemIds.length > 0) {
      for (const rid of params.removeItemIds) {
        itemsMap.delete(rid);
      }
    }

    // 2. Apply updates
    if (params.updateItems && params.updateItems.length > 0) {
      for (const upd of params.updateItems) {
        const existing = itemsMap.get(upd.itemId);
        if (!existing) {
          return toolResult({ success: false, error: `Item ${upd.itemId} not found` });
        }
        // Derive existing parts cost from the already-stored total so we don't
        // zero it out on a description/intent-only patch.
        const existingLaborHours = (existing as unknown as { laborHours?: number }).laborHours ?? 0;
        const existingLaborCents = Math.round(existingLaborHours * 140 * 100);
        const existingPartsCents = Math.max(0, existing.totalCents - existingLaborCents);
        const existingPartsCost = existingPartsCents / 100;
        // Rebuild with new values, keeping stable ID
        const rebuilt = await buildItem(
          upd.description ?? existing.name,
          upd.labor_hours ?? existingLaborHours,
          upd.parts_cost ?? existingPartsCost,
          upd.intent ??
            (existing as unknown as { metadata?: { intent?: string } }).metadata?.intent as
              | "replace"
              | "inspect"
              | "optional"
              | "note" ??
            "replace",
          upd.itemId, // keep same ID
        );
        itemsMap.set(upd.itemId, rebuilt);
      }
    }

    // 3. Apply additions
    if (params.addItems && params.addItems.length > 0) {
      for (const add of params.addItems) {
        const newItem = await buildItem(
          add.description,
          add.labor_hours,
          add.parts_cost,
          add.intent ?? "replace",
          add.itemId, // use provided or generate below
        );
        itemsMap.set(newItem.id, newItem);
      }
    }

    // Build final arrays
    const finalItems = Array.from(itemsMap.values());
    const subtotalCents = finalItems.reduce((sum, i) => sum + i.totalCents, 0);

    const updates: Record<string, unknown> = {
      items: finalItems,
      subtotalCents,
      priceRangeLowCents: Math.round(subtotalCents * 0.9),
      priceRangeHighCents: Math.round(subtotalCents * 1.1),
      revisionNumber: currentVersion + 1,
      updatedAt: new Date(),
    };

    if (params.notes !== undefined) {
      updates.notes = params.notes;
    }

    // Optimistic concurrency update — require row's revisionNumber to match the
    // value we read, so concurrent writers collide instead of silently overwriting.
    const [updated] = await db
      .update(schema.orders)
      .set(updates)
      .where(
        sql`${schema.orders.id} = ${id}
          AND ${schema.orders.status} = ${order.status}
          AND COALESCE(${schema.orders.revisionNumber}, 0) = ${currentVersion}`,
      )
      .returning();

    if (!updated) {
      return toolResult({
        success: false,
        error:
          "Order was modified concurrently (status or revisionNumber changed) — refresh and retry",
      });
    }

    // Record idempotency
    if (params.idempotencyKey) {
      executedKeys.add(params.idempotencyKey);
    }

    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "items_edited",
      actor: "agent",
      metadata: {
        added: params.addItems?.map((i) => i.description) ?? [],
        updated: params.updateItems?.map((i) => i.itemId) ?? [],
        removed: params.removeItemIds ?? [],
        newVersion: currentVersion + 1,
      },
    });

    return toolResult({
      success: true,
      orderId: updated.id,
      status: updated.status,
      version: currentVersion + 1,
      subtotalFormatted: `$${((updated.subtotalCents ?? 0) / 100).toFixed(2)}`,
      itemCount: finalItems.length,
      notes: updated.notes,
      message: `Order #${id} updated`,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 5: update_order -- generic order metadata update
// ---------------------------------------------------------------------------

const updateOrderTool = {
  name: "update_order",
  description: "Update order metadata: customer info, vehicle info, notes. " +
    "Use this when customer provides their name/phone/email/vin AFTER order was created. " +
    "Supports partial updates — only include fields you want to change. " +
    "Does NOT change items or pricing.",
  schema: z.object({
    order_id: z.string().describe("The order ID to update"),
    customerInfo: z
      .object({
        name: z.string().optional().describe("Customer full name"),
        phone: z.string().optional().describe("Phone number"),
        email: z.string().email().optional().describe("Email address"),
        address: z.string().optional().describe("Street address"),
      })
      .optional()
      .describe("Customer contact information to update"),
    vehicleInfo: z
      .object({
        year: z
          .number()
          .int()
          .min(1900)
          .max(2030)
          .optional()
          .describe("Vehicle year (e.g., 2019)"),
        make: z.string().optional().describe("Vehicle make (e.g., 'Ford')"),
        model: z.string().optional().describe("Vehicle model (e.g., 'F-150')"),
        engine: z.string().optional().describe("Engine description (e.g., '5.0L V8')"),
        vin: z
          .string()
          .length(17)
          .regex(/^[A-HJ-NPR-Z0-9]{17}$/)
          .optional()
          .describe("VIN (17 chars, no I/O/Q)"),
        licensePlate: z.string().optional().describe("License plate number"),
        mileage: z.number().int().optional().describe("Current odometer reading"),
      })
      .optional()
      .describe("Vehicle information to update"),
    notes: z.string().optional().describe("Order notes"),
    expectedVersion: z.number().int().optional().describe(
      "Expected revisionNumber for optimistic concurrency",
    ),
    idempotencyKey: z.string().optional().describe("Idempotency key"),
  }),
  execute: async (
    params: {
      order_id: string;
      customerInfo?: { name?: string; phone?: string; email?: string; address?: string };
      vehicleInfo?: {
        year?: number;
        make?: string;
        model?: string;
        engine?: string;
        vin?: string;
        licensePlate?: string;
        mileage?: number;
      };
      notes?: string;
      expectedVersion?: number;
      idempotencyKey?: string;
    },
    _ctx: unknown,
  ) => {
    const id = Number(params.order_id);
    if (!Number.isInteger(id) || id <= 0) {
      return toolResult({ success: false, error: "Invalid order_id" });
    }

    if (
      params.customerInfo === undefined &&
      params.vehicleInfo === undefined &&
      params.notes === undefined
    ) {
      return toolResult({
        success: false,
        error: "Provide at least one of: customerInfo, vehicleInfo, notes",
      });
    }

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);

    if (!order) {
      return toolResult({ success: false, error: `Order #${id} not found` });
    }

    const currentVersion = (order as unknown as { revisionNumber?: number }).revisionNumber ?? 0;
    if (params.expectedVersion !== undefined && params.expectedVersion !== currentVersion) {
      return toolResult({
        success: false,
        error: `Version mismatch: expected ${params.expectedVersion}, got ${currentVersion}`,
        currentVersion,
      });
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
      revisionNumber: currentVersion + 1,
    };

    if (params.customerInfo !== undefined) {
      if (params.customerInfo.name !== undefined) updates.contactName = params.customerInfo.name;
      if (params.customerInfo.phone !== undefined) updates.contactPhone = params.customerInfo.phone;
      if (params.customerInfo.email !== undefined) updates.contactEmail = params.customerInfo.email;
      if (params.customerInfo.address !== undefined) {
        updates.contactAddress = params.customerInfo.address;
      }
    }

    if (params.vehicleInfo !== undefined) {
      const existingVehicle =
        (order as unknown as { vehicleInfo?: Record<string, unknown> }).vehicleInfo ?? {};
      updates.vehicleInfo = {
        ...existingVehicle,
        ...params.vehicleInfo,
        year: params.vehicleInfo.year
          ? String(params.vehicleInfo.year)
          : (existingVehicle.year as string | undefined),
        vin: params.vehicleInfo.vin?.toUpperCase() ?? (existingVehicle.vin as string | undefined),
      };
    }

    if (params.notes !== undefined) {
      updates.notes = params.notes;
    }

    // Enforce optimistic concurrency at the SQL layer: the row we read must
    // still carry the same revisionNumber when we write.
    const [updated] = await db
      .update(schema.orders)
      .set(updates)
      .where(
        sql`${schema.orders.id} = ${id}
          AND COALESCE(${schema.orders.revisionNumber}, 0) = ${currentVersion}`,
      )
      .returning();

    if (!updated) {
      return toolResult({
        success: false,
        error: "Order was modified concurrently (revisionNumber changed) — refresh and retry",
      });
    }

    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "order_updated",
      actor: "agent",
      metadata: {
        updatedFields: Object.keys(updates).filter(
          (k) => !["updatedAt", "revisionNumber"].includes(k),
        ),
        newVersion: currentVersion + 1,
      },
    });

    const vehicle =
      (updated as unknown as { vehicleInfo?: { year?: string; make?: string; model?: string } })
        .vehicleInfo;
    return toolResult({
      success: true,
      orderId: updated.id,
      version: currentVersion + 1,
      contactName: updated.contactName,
      contactPhone: updated.contactPhone,
      contactEmail: updated.contactEmail,
      vehicle: vehicle
        ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")
        : null,
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
  updateOrderTool,
];
