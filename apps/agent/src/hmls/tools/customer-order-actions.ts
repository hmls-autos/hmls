import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client.ts";
import { toolResult } from "@hmls/shared/tool-result";

// Statuses a customer is allowed to cancel from (before any money changes hands)
const CUSTOMER_CANCELLABLE_STATUSES = ["draft", "estimated", "sent"];

// ---------------------------------------------------------------------------
// Tool 1: approve_order
// ---------------------------------------------------------------------------

const approveOrderTool = {
  name: "approve_order",
  description:
    "Customer approves an estimate/quote. Only valid when the order is in 'sent' status. " +
    "This does not charge the customer — it signals acceptance so the shop can proceed to invoice.",
  schema: z.object({
    orderId: z.string().describe("The order ID to approve"),
  }),
  execute: async (params: { orderId: string }, _ctx: unknown) => {
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

    if (order.status !== "sent") {
      return toolResult({
        success: false,
        error:
          `Order #${id} cannot be approved — current status is '${order.status}'. Only 'sent' orders can be approved.`,
      });
    }

    await db
      .update(schema.orders)
      .set({
        status: "approved",
        statusHistory: [
          ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
          { status: "approved", timestamp: new Date().toISOString(), actor: "customer" },
        ],
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, id));

    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "status_change",
      fromStatus: "sent",
      toStatus: "approved",
      actor: "customer",
      metadata: {},
    });

    return toolResult({
      success: true,
      orderId: id,
      newStatus: "approved",
      message: `Order #${id} approved. The shop will proceed with invoicing.`,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 2: decline_order
// ---------------------------------------------------------------------------

const declineOrderTool = {
  name: "decline_order",
  description:
    "Customer declines an estimate/quote. Only valid when the order is in 'sent' status. " +
    "The shop may revise and resend the estimate.",
  schema: z.object({
    orderId: z.string().describe("The order ID to decline"),
    reason: z.string().optional().describe("Optional reason for declining"),
  }),
  execute: async (params: { orderId: string; reason?: string }, _ctx: unknown) => {
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

    if (order.status !== "sent") {
      return toolResult({
        success: false,
        error:
          `Order #${id} cannot be declined — current status is '${order.status}'. Only 'sent' orders can be declined.`,
      });
    }

    await db
      .update(schema.orders)
      .set({
        status: "declined",
        statusHistory: [
          ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
          { status: "declined", timestamp: new Date().toISOString(), actor: "customer" },
        ],
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, id));

    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "status_change",
      fromStatus: "sent",
      toStatus: "declined",
      actor: "customer",
      metadata: params.reason ? { reason: params.reason } : {},
    });

    return toolResult({
      success: true,
      orderId: id,
      newStatus: "declined",
      message: `Order #${id} declined. The shop has been notified and may revise the estimate.`,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 3: cancel_order
// ---------------------------------------------------------------------------

const cancelOrderTool = {
  name: "cancel_order",
  description:
    "Customer cancels an order. Only allowed when the order has not yet been invoiced or paid " +
    `(statuses: ${CUSTOMER_CANCELLABLE_STATUSES.join(", ")}). ` +
    "Cannot cancel orders that are already invoiced, paid, in progress, or completed.",
  schema: z.object({
    orderId: z.string().describe("The order ID to cancel"),
    reason: z.string().optional().describe("Optional reason for cancellation"),
  }),
  execute: async (params: { orderId: string; reason?: string }, _ctx: unknown) => {
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

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
      return toolResult({
        success: false,
        error: `Order #${id} cannot be cancelled — current status is '${order.status}'. ` +
          `Customers can only cancel orders in: ${CUSTOMER_CANCELLABLE_STATUSES.join(", ")}. ` +
          "Please contact the shop directly to discuss cancellation.",
      });
    }

    await db
      .update(schema.orders)
      .set({
        status: "cancelled",
        cancellationReason: params.reason ?? "Cancelled by customer",
        statusHistory: [
          ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
          { status: "cancelled", timestamp: new Date().toISOString(), actor: "customer" },
        ],
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, id));

    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "status_change",
      fromStatus: order.status,
      toStatus: "cancelled",
      actor: "customer",
      metadata: { reason: params.reason ?? "Cancelled by customer" },
    });

    return toolResult({
      success: true,
      orderId: id,
      newStatus: "cancelled",
      message: `Order #${id} has been cancelled.`,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 4: request_reschedule
// ---------------------------------------------------------------------------

const requestRescheduleTool = {
  name: "request_reschedule",
  description: "Customer requests a reschedule for a scheduled or upcoming appointment. " +
    "This does NOT change the appointment time — it adds a note for the shop to follow up. " +
    "The shop will contact the customer to confirm a new time.",
  schema: z.object({
    orderId: z.string().describe("The order ID for the appointment to reschedule"),
    requestedTime: z
      .string()
      .optional()
      .describe("Preferred new time/date (e.g. 'Thursday afternoon', 'anytime next week')"),
    reason: z.string().optional().describe("Reason for rescheduling"),
  }),
  execute: async (
    params: { orderId: string; requestedTime?: string; reason?: string },
    _ctx: unknown,
  ) => {
    const id = Number(params.orderId);
    if (!Number.isInteger(id) || id <= 0) {
      return toolResult({ success: false, error: "Invalid order ID" });
    }

    const [order] = await db
      .select({ id: schema.orders.id, status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);

    if (!order) {
      return toolResult({ success: false, error: `Order #${id} not found` });
    }

    const noteLines = ["[Customer reschedule request]"];
    if (params.requestedTime) noteLines.push(`Preferred time: ${params.requestedTime}`);
    if (params.reason) noteLines.push(`Reason: ${params.reason}`);

    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "note_added",
      actor: "customer",
      metadata: { note: noteLines.join("\n") },
    });

    return toolResult({
      success: true,
      orderId: id,
      message:
        "Reschedule request noted. The shop will contact you to confirm a new appointment time.",
    });
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const customerOrderActionTools = [
  approveOrderTool,
  declineOrderTool,
  cancelOrderTool,
  requestRescheduleTool,
];
