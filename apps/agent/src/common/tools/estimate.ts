// apps/agent/src/common/tools/estimate.ts
//
// Order-lifecycle refactor: writes directly to `orders` table (status "draft")
// with items stored as OrderItem[] JSONB.  No more `estimates` table inserts.

import { z } from "zod";
import { nanoid } from "nanoid";
import { db, schema } from "../../db/client.ts";
import { eq } from "drizzle-orm";
import {
  buildFeeItems,
  calculateDiscount,
  calculatePrice,
  getPricingConfig,
} from "../../hmls/skills/estimate/pricing.ts";
import { toolResult } from "@hmls/shared/tool-result";
import type { DiscountType, LineItem, ServiceInput } from "../../hmls/skills/estimate/types.ts";
import type { OrderItem } from "../../db/schema.ts";

const discountEnum = z.enum([
  "returning_customer",
  "referral",
  "fleet",
  "senior",
  "military",
  "first_responder",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a legacy LineItem into the unified OrderItem format. */
function toOrderItem(
  item: LineItem,
  category: OrderItem["category"],
  opts?: { laborHours?: number; quantity?: number },
): OrderItem {
  const quantity = opts?.quantity ?? 1;
  return {
    id: crypto.randomUUID(),
    category,
    name: item.name,
    description: item.description || undefined,
    quantity,
    unitPriceCents: item.price,
    totalCents: item.price * quantity,
    taxable: category !== "discount",
    ...(opts?.laborHours ? { laborHours: opts.laborHours } : {}),
  };
}

// ---------------------------------------------------------------------------
// create_estimate  →  creates an order in "draft" status
// ---------------------------------------------------------------------------

export const createEstimateTool = {
  name: "create_estimate",
  description:
    "Generate a price estimate for services. Provide vehicle info directly (year/make/model). " +
    "If the user is a known customer, also pass customerId to save the estimate to their account. " +
    "The system automatically applies disposal fees, time surcharges, travel fees, and discounts.",
  schema: z.object({
    // Customer agent: leave blank — auth context supplies the customer.
    // Staff agent: pass explicit customerId (e.g. after find_customer) to
    // create an estimate on behalf of a walk-in customer.
    customerId: z
      .number()
      .optional()
      .describe(
        "Customer ID. Customer agents should omit (auth context wins). Staff agents: pass the target customer's ID.",
      ),
    vehicle: z
      .object({
        year: z.number().describe("Vehicle year, e.g. 2015"),
        make: z.string().describe("Vehicle make, e.g. 'Honda'"),
        model: z.string().describe("Vehicle model, e.g. 'Civic'"),
      })
      .describe("Vehicle the estimate is for"),
    services: z
      .array(
        z.object({
          name: z.string().describe("Service name"),
          description: z.string().describe("Brief description"),
          laborHours: z
            .number()
            .optional()
            .describe(
              "Labor hours from OLP lookup, or your best estimate if OLP has no data",
            ),
          partsCost: z
            .number()
            .optional()
            .describe("Estimated parts cost in dollars"),
          involvesHazmat: z
            .boolean()
            .default(false)
            .describe(
              "True if service involves hazardous fluids (oil change, coolant flush, brake fluid, etc.)",
            ),
          tireCount: z
            .number()
            .optional()
            .describe("Number of tires being disposed (tire services only)"),
          involvesBattery: z
            .boolean()
            .default(false)
            .describe("True if service involves battery replacement"),
        }),
      )
      .describe("List of services to include in estimate"),
    customItems: z
      .array(
        z.object({
          name: z.string().describe("Item name (e.g. 'Diagnostic Fee', 'Custom Fabrication')"),
          description: z.string().describe("Brief description of the charge"),
          price: z.number().describe("Price in dollars (e.g. 95 for $95)"),
        }),
      )
      .optional()
      .describe(
        "Freeform line items that bypass the labor/parts pricing engine. Use for diagnostic fees, custom work, flat-rate services, or anything not in OLP.",
      ),
    notes: z
      .string()
      .optional()
      .describe("Additional notes for the estimate"),
    validDays: z
      .number()
      .default(14)
      .describe("Days until estimate expires"),

    // Scheduling
    isRush: z
      .boolean()
      .default(false)
      .describe("Same-day service requested"),
    isAfterHours: z
      .boolean()
      .default(false)
      .describe("After 6pm appointment"),
    isEarlyMorning: z
      .boolean()
      .default(false)
      .describe("Before 8am appointment"),
    isWeekend: z
      .boolean()
      .default(false)
      .describe("Saturday appointment"),
    isSunday: z
      .boolean()
      .default(false)
      .describe("Sunday appointment"),
    isHoliday: z
      .boolean()
      .default(false)
      .describe("Holiday appointment"),

    // Travel
    travelMiles: z
      .number()
      .optional()
      .describe(
        "Distance to customer in miles. First 15 mi are free, then $1/mi.",
      ),

    // Discount
    discountType: discountEnum
      .optional()
      .describe(
        "Discount type to apply (returning_customer, referral, fleet, senior, military, first_responder)",
      ),
  }),
  execute: async (
    params: {
      customerId?: number;
      vehicle: { year: number; make: string; model: string };
      services: ServiceInput[];
      customItems?: { name: string; description: string; price: number }[];
      notes?: string;
      validDays?: number;
      isRush?: boolean;
      isAfterHours?: boolean;
      isEarlyMorning?: boolean;
      isWeekend?: boolean;
      isSunday?: boolean;
      isHoliday?: boolean;
      travelMiles?: number;
      discountType?: DiscountType;
    },
    ctx: { customerId?: number } | undefined,
  ) => {
    // 1. Resolve customer — auth context takes precedence over AI-supplied param.
    const customerId = ctx?.customerId ?? params.customerId;
    let customer;
    if (customerId) {
      const [found] = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, customerId))
        .limit(1);
      customer = found;
    }

    // 2. Calculate service line items (labor + parts)
    const serviceLineItems = await Promise.all(
      params.services.map((s) => calculatePrice(s)),
    );

    // 2b. Convert custom items (dollars → cents)
    const customLineItems: LineItem[] = (params.customItems ?? []).map((c) => ({
      name: c.name,
      description: c.description,
      price: Math.round(c.price * 100),
    }));

    const config = await getPricingConfig();
    const laborCents = params.services.reduce(
      (sum, s) => sum + Math.round((s.laborHours ?? 0) * config.hourlyRate),
      0,
    );

    // 3. Build fee line items
    const feeLineItems = buildFeeItems(config, {
      isRush: params.isRush,
      isAfterHours: params.isAfterHours,
      isWeekend: params.isWeekend,
      isSunday: params.isSunday,
      isHoliday: params.isHoliday,
      isEarlyMorning: params.isEarlyMorning,
      travelMiles: params.travelMiles,
      totalLaborCents: laborCents,
      services: params.services,
    });

    // 4. Convert LineItems → OrderItem[] (unified item model)
    const orderItems: OrderItem[] = [
      ...serviceLineItems.map((li, i) =>
        toOrderItem(li, "labor", { laborHours: params.services[i]?.laborHours })
      ),
      ...customLineItems.map((li) => toOrderItem(li, "labor")),
      ...feeLineItems.map((li) => toOrderItem(li, "fee")),
    ];

    // 5. Calculate subtotal before discount
    const subtotalBeforeDiscount = orderItems.reduce(
      (sum, item) => sum + item.totalCents,
      0,
    );

    // 6. Apply discount
    const discount = calculateDiscount(
      config,
      subtotalBeforeDiscount,
      params.discountType,
      params.services.length,
    );

    if (discount && discount.amount > 0) {
      orderItems.push({
        id: crypto.randomUUID(),
        category: "discount",
        name: "Discount",
        description: discount.label,
        quantity: 1,
        unitPriceCents: -discount.amount,
        totalCents: -discount.amount,
        taxable: false,
      });
    }

    // 7. Final subtotal (enforce minimum service fee)
    let subtotal = orderItems.reduce((sum, item) => sum + item.totalCents, 0);
    if (subtotal < config.minimumServiceFee) {
      subtotal = config.minimumServiceFee;
    }

    const rangeLow = Math.round(subtotal * 0.9);
    const rangeHigh = Math.round(subtotal * 1.1);

    // 8. Generate share token
    const shareToken = nanoid(32);
    const validDays = params.validDays ?? 14;
    const expiresAt = new Date(
      Date.now() + validDays * 24 * 60 * 60 * 1000,
    );

    // 9. Save to DB if we have a customer, otherwise return pricing only
    if (customer) {
      // Create as draft — shop admin reviews before sending to customer.
      const [order] = await db
        .insert(schema.orders)
        .values({
          customerId: customer.id,
          status: "draft",
          statusHistory: [
            { status: "draft", timestamp: new Date().toISOString(), actor: "agent" },
          ],
          items: orderItems,
          notes: params.notes ?? null,
          subtotalCents: subtotal,
          priceRangeLowCents: rangeLow,
          priceRangeHighCents: rangeHigh,
          vehicleInfo: {
            year: String(params.vehicle.year),
            make: params.vehicle.make,
            model: params.vehicle.model,
          },
          shareToken,
          validDays,
          expiresAt,
          contactName: customer.name ?? null,
          contactEmail: customer.email ?? null,
          contactPhone: customer.phone ?? null,
          contactAddress: customer.address ?? null,
        })
        .returning();

      await db.insert(schema.orderEvents).values({
        orderId: order.id,
        eventType: "status_change",
        fromStatus: null,
        toStatus: "draft",
        actor: "agent",
        metadata: {
          vehicleInfo: params.vehicle,
          itemCount: orderItems.length,
        },
      });

      return toolResult({
        success: true,
        orderId: order.id,
        status: "draft",
        pendingReview: true,
        vehicle: `${params.vehicle.year} ${params.vehicle.make} ${params.vehicle.model}`,
        items: orderItems.map((i) => ({
          name: i.name,
          description: i.description,
          unitPriceCents: i.unitPriceCents,
          totalCents: i.totalCents,
          quantity: i.quantity,
          category: i.category,
        })),
        subtotal: subtotal / 100,
        priceRange: `$${(rangeLow / 100).toFixed(2)} - $${(rangeHigh / 100).toFixed(2)}`,
        expiresAt,
        note:
          "Draft estimate saved for shop team review. Customer will receive the finalized estimate after review.",
      });
    }

    // Anonymous user — return pricing without saving
    return toolResult({
      success: true,
      vehicle: `${params.vehicle.year} ${params.vehicle.make} ${params.vehicle.model}`,
      items: orderItems.map((i) => ({
        name: i.name,
        description: i.description,
        unitPriceCents: i.unitPriceCents,
        totalCents: i.totalCents,
        quantity: i.quantity,
        category: i.category,
      })),
      subtotal: subtotal / 100,
      priceRange: `$${(rangeLow / 100).toFixed(2)} - $${(rangeHigh / 100).toFixed(2)}`,
      note: "Estimate not saved — customer not signed in.",
    });
  },
};

// ---------------------------------------------------------------------------
// get_estimate  →  reads from orders table
// ---------------------------------------------------------------------------

export const getEstimateTool = {
  name: "get_estimate",
  description: "Retrieve an existing order/estimate by ID to check status, items, or details. " +
    "Reads from the orders table.",
  schema: z.object({
    orderId: z.number().describe("Order ID from database"),
  }),
  execute: async (params: { orderId: number }, _ctx: unknown) => {
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, params.orderId))
      .limit(1);

    if (!order) {
      return toolResult({ found: false, message: "Order not found" });
    }

    const isExpired = order.expiresAt ? new Date() > order.expiresAt : false;
    const items = (order.items ?? []) as OrderItem[];

    return toolResult({
      found: true,
      order: {
        id: order.id,
        status: order.status,
        items: items.map((i) => ({
          name: i.name,
          description: i.description,
          unitPriceCents: i.unitPriceCents,
          totalCents: i.totalCents,
          quantity: i.quantity,
          category: i.category,
        })),
        subtotal: (order.subtotalCents ?? 0) / 100,
        priceRange: order.priceRangeLowCents && order.priceRangeHighCents
          ? `$${(order.priceRangeLowCents / 100).toFixed(2)} - $${
            (order.priceRangeHighCents / 100).toFixed(2)
          }`
          : null,
        notes: order.notes,
        vehicleInfo: order.vehicleInfo,
        expiresAt: order.expiresAt,
        isExpired,
        revisionNumber: order.revisionNumber,
        downloadUrl: `/api/orders/${order.id}/pdf`,
        shareUrl: order.shareToken ? `/api/orders/${order.id}/pdf?token=${order.shareToken}` : null,
      },
    });
  },
};

export const estimateTools = [createEstimateTool, getEstimateTool];
