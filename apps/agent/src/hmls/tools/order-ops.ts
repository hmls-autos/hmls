import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.ts";
import { toolResult } from "@hmls/shared/tool-result";

// Valid order statuses matching the gateway state machine
const ORDER_STATUSES = [
  "draft",
  "estimated",
  "revised",
  "sent",
  "approved",
  "invoiced",
  "paid",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "void",
  "archived",
  "declined",
] as const;

// Mirrors the state machine in gateway/src/routes/orders.ts
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
  archived: [],
  cancelled: [],
  void: [],
};

// ---------------------------------------------------------------------------
// Tool 1: transition_order_status
// ---------------------------------------------------------------------------

const transitionOrderStatusTool = {
  name: "transition_order_status",
  description:
    "Transition an order to a new status. Validates the transition against the allowed state machine. " +
    "Use get_order_status first to confirm the current status before transitioning.",
  schema: z.object({
    orderId: z.string().describe("The order ID (numeric string or number)"),
    newStatus: z
      .enum(ORDER_STATUSES)
      .describe("The target status to transition to"),
    reason: z
      .string()
      .optional()
      .describe("Optional reason for the transition (e.g. cancellation reason)"),
  }),
  execute: async (
    params: {
      orderId: string;
      newStatus: (typeof ORDER_STATUSES)[number];
      reason?: string;
    },
    _ctx: unknown,
  ) => {
    const id = Number(params.orderId);
    if (!Number.isInteger(id) || id <= 0) {
      return toolResult({ success: false, error: "Invalid order ID" });
    }

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);

    if (!order) {
      return toolResult({ success: false, error: `Order #${id} not found` });
    }

    const allowed = TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(params.newStatus)) {
      return toolResult({
        success: false,
        error: `Cannot transition from '${order.status}' to '${params.newStatus}'. Allowed transitions: ${
          allowed.join(", ") || "none (terminal state)"
        }`,
      });
    }

    const previousStatus = order.status;
    const actor = "agent";
    const updateFields: Record<string, unknown> = {
      status: params.newStatus,
      statusHistory: [
        ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
        { status: params.newStatus, timestamp: new Date().toISOString(), actor },
      ],
      updatedAt: new Date(),
    };

    if (params.newStatus === "cancelled" && params.reason) {
      updateFields.cancellationReason = params.reason;
    }

    const [updated] = await db
      .update(schema.orders)
      .set(updateFields)
      .where(eq(schema.orders.id, id))
      .returning();

    if (!updated) {
      return toolResult({ success: false, error: "Update failed — concurrent modification" });
    }

    // Log the event
    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "status_change",
      fromStatus: previousStatus,
      toStatus: params.newStatus,
      actor,
      metadata: params.reason ? { reason: params.reason } : {},
    });

    return toolResult({
      success: true,
      orderId: id,
      previousStatus,
      newStatus: params.newStatus,
      message: `Order #${id} transitioned from '${previousStatus}' to '${params.newStatus}'`,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 2: add_order_note
// ---------------------------------------------------------------------------

const addOrderNoteTool = {
  name: "add_order_note",
  description:
    "Add an internal note to an order's audit log. Use this to record context, " +
    "customer communications, or follow-up actions that aren't status changes.",
  schema: z.object({
    orderId: z.string().describe("The order ID (numeric string or number)"),
    note: z.string().describe("The note text to add to the order"),
  }),
  execute: async (
    params: {
      orderId: string;
      note: string;
    },
    _ctx: unknown,
  ) => {
    const id = Number(params.orderId);
    if (!Number.isInteger(id) || id <= 0) {
      return toolResult({ success: false, error: "Invalid order ID" });
    }

    const [order] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);

    if (!order) {
      return toolResult({ success: false, error: `Order #${id} not found` });
    }

    const [event] = await db
      .insert(schema.orderEvents)
      .values({
        orderId: id,
        eventType: "note_added",
        actor: "agent",
        metadata: { note: params.note },
      })
      .returning();

    return toolResult({
      success: true,
      eventId: event.id,
      orderId: id,
      message: `Note added to order #${id}`,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 3: get_order_status
// ---------------------------------------------------------------------------

const getOrderStatusTool = {
  name: "get_order_status",
  description:
    "Look up an order's current status, line item summary, and next expected step. " +
    "Can search by order ID, customer email, or customer phone number.",
  schema: z.object({
    orderId: z
      .string()
      .optional()
      .describe("The order ID to look up directly"),
    customerEmail: z
      .string()
      .optional()
      .describe("Customer email address to find their most recent order"),
    customerPhone: z
      .string()
      .optional()
      .describe("Customer phone number to find their most recent order"),
  }),
  execute: async (
    params: {
      orderId?: string;
      customerEmail?: string;
      customerPhone?: string;
    },
    _ctx: unknown,
  ) => {
    if (!params.orderId && !params.customerEmail && !params.customerPhone) {
      return toolResult({
        success: false,
        error: "Provide at least one of: orderId, customerEmail, or customerPhone",
      });
    }

    let order: typeof schema.orders.$inferSelect | undefined;

    if (params.orderId) {
      const id = Number(params.orderId);
      if (!Number.isInteger(id) || id <= 0) {
        return toolResult({ success: false, error: "Invalid order ID" });
      }
      const [row] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, id))
        .limit(1);
      order = row;
    } else {
      // Look up by customer
      const customer = await (async () => {
        if (params.customerEmail) {
          const [row] = await db
            .select()
            .from(schema.customers)
            .where(eq(schema.customers.email, params.customerEmail))
            .limit(1);
          return row;
        }
        if (params.customerPhone) {
          const [row] = await db
            .select()
            .from(schema.customers)
            .where(eq(schema.customers.phone, params.customerPhone))
            .limit(1);
          return row;
        }
      })();

      if (!customer) {
        return toolResult({
          success: false,
          error: "No customer found with that email or phone",
        });
      }

      // Get the most recent non-archived, non-cancelled order
      const [row] = await db
        .select()
        .from(schema.orders)
        .where(
          sql`${schema.orders.customerId} = ${customer.id} AND ${schema.orders.status} NOT IN ('archived', 'cancelled', 'void')`,
        )
        .orderBy(desc(schema.orders.createdAt))
        .limit(1);

      if (!row) {
        // Fall back to any order
        const [anyRow] = await db
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.customerId, customer.id))
          .orderBy(desc(schema.orders.createdAt))
          .limit(1);
        order = anyRow;
      } else {
        order = row;
      }
    }

    if (!order) {
      return toolResult({ success: false, error: "No order found" });
    }

    // Determine next expected step
    const nextSteps = TRANSITIONS[order.status] ?? [];
    const nextStepHint = nextSteps.length > 0
      ? `Next allowed transitions: ${nextSteps.join(", ")}`
      : "Order is in a terminal state";

    // Summarize line items
    const items = Array.isArray(order.items) ? order.items : [];
    const itemSummary = items.map((item: Record<string, unknown>) =>
      `${item.name} (${item.category}) x${item.quantity} @ $${
        ((item.unitPriceCents as number) / 100).toFixed(2)
      }`
    );

    return toolResult({
      success: true,
      orderId: order.id,
      status: order.status,
      contactName: order.contactName,
      contactEmail: order.contactEmail,
      contactPhone: order.contactPhone,
      subtotalCents: order.subtotalCents,
      subtotalFormatted: `$${((order.subtotalCents ?? 0) / 100).toFixed(2)}`,
      itemCount: items.length,
      itemSummary,
      notes: order.notes,
      adminNotes: order.adminNotes,
      cancellationReason: order.cancellationReason,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      nextStepHint,
    });
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const orderOpsTools = [
  transitionOrderStatusTool,
  addOrderNoteTool,
  getOrderStatusTool,
];
