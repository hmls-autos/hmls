import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db/client.ts";
import { toolResult } from "@hmls/shared/tool-result";
import type { ToolContext } from "../../common/convert-tools.ts";

// After Layer 3 there is no separate bookings entity — scheduling lives on the
// order. Customers can cancel / reschedule while the order is in `scheduled`
// (before the shop has started work).
const CUSTOMER_CANCELLABLE_STATUSES = ["scheduled"];

// ---------------------------------------------------------------------------
// Tool 1: cancel_booking — cancel a scheduled order
// ---------------------------------------------------------------------------

const cancelBookingTool = {
  name: "cancel_booking",
  description:
    "Customer cancels their scheduled appointment. Only allowed while the order is in 'scheduled' " +
    "status. Once the shop has started work, cancellations must go through staff.",
  schema: z.object({
    orderId: z.string().describe("The order ID to cancel the appointment on"),
    reason: z.string().optional().describe("Optional reason for cancellation"),
  }),
  execute: async (
    params: { orderId: string; reason?: string },
    ctx: ToolContext | undefined,
  ) => {
    const id = Number(params.orderId);
    if (!Number.isInteger(id) || id <= 0) {
      return toolResult({ success: false, error: "Invalid order ID" });
    }

    if (!ctx?.customerId) {
      return toolResult({ success: false, error: "Authentication required" });
    }

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);

    if (!order || order.customerId !== ctx.customerId) {
      return toolResult({ success: false, error: `Order #${id} not found` });
    }

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
      return toolResult({
        success: false,
        error: `Order #${id} cannot be cancelled — current status is '${order.status}'. ` +
          "Only 'scheduled' orders can be cancelled by the customer. " +
          "For in-progress work, please contact the shop directly.",
      });
    }

    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    await db
      .update(schema.orders)
      .set({
        status: "cancelled",
        cancellationReason: params.reason ?? null,
        statusHistory: [
          ...history,
          { status: "cancelled", timestamp: new Date().toISOString(), actor: "customer" },
        ],
        updatedAt: new Date(),
      })
      .where(and(eq(schema.orders.id, id), eq(schema.orders.status, "scheduled")));

    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "status_change",
      fromStatus: "scheduled",
      toStatus: "cancelled",
      actor: "customer",
      metadata: params.reason ? { reason: params.reason } : {},
    });

    return toolResult({
      success: true,
      orderId: id,
      newStatus: "cancelled",
      message: `Your appointment for order #${id} has been cancelled.`,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool 2: request_booking_reschedule — flag for staff review
// ---------------------------------------------------------------------------

const requestRescheduleTool = {
  name: "request_booking_reschedule",
  description:
    "Customer requests to reschedule their appointment. Does NOT directly change the appointment — " +
    "it records a note on the order for staff to review and follow up.",
  schema: z.object({
    orderId: z.string().describe("The order ID to reschedule"),
    preferredTime: z
      .string()
      .optional()
      .describe("Preferred new time/date (e.g. 'Thursday afternoon', 'next Monday morning')"),
    reason: z.string().optional().describe("Reason for rescheduling"),
  }),
  execute: async (
    params: { orderId: string; preferredTime?: string; reason?: string },
    ctx: ToolContext | undefined,
  ) => {
    const id = Number(params.orderId);
    if (!Number.isInteger(id) || id <= 0) {
      return toolResult({ success: false, error: "Invalid order ID" });
    }

    if (!ctx?.customerId) {
      return toolResult({ success: false, error: "Authentication required" });
    }

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);

    if (!order || order.customerId !== ctx.customerId) {
      return toolResult({ success: false, error: `Order #${id} not found` });
    }

    const terminalStatuses = ["completed", "cancelled", "declined"];
    if (terminalStatuses.includes(order.status)) {
      return toolResult({
        success: false,
        error: `Order #${id} is '${order.status}' and cannot be rescheduled.`,
      });
    }

    const noteLines = ["[Reschedule request]"];
    if (params.preferredTime) noteLines.push(`Preferred time: ${params.preferredTime}`);
    if (params.reason) noteLines.push(`Reason: ${params.reason}`);
    const note = noteLines.join("\n");

    await db
      .update(schema.orders)
      .set({
        customerNotes: order.customerNotes ? `${order.customerNotes}\n${note}` : note,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, id));

    await db.insert(schema.orderEvents).values({
      orderId: id,
      eventType: "note_added",
      actor: "customer",
      metadata: { note },
    });

    return toolResult({
      success: true,
      orderId: id,
      message: order.status === "scheduled"
        ? "Reschedule request submitted. The shop will contact you to confirm a new time."
        : "Reschedule request noted. The shop will review.",
    });
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const customerBookingActionTools = [
  cancelBookingTool,
  requestRescheduleTool,
];
