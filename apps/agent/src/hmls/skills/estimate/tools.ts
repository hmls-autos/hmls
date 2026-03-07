// apps/agent/src/skills/estimate/tools.ts

import { z } from "zod";
import { nanoid } from "nanoid";
import { db, schema } from "../../../db/client.ts";
import { eq } from "drizzle-orm";
import { buildFeeItems, calculateDiscount, calculatePrice, getPricingConfig } from "./pricing.ts";
import { toolResult } from "@hmls/shared/tool-result";
import type { DiscountType, LineItem, ServiceInput } from "./types.ts";
import { notifyOrderStatusChange } from "../../../lib/notifications.ts";

const discountEnum = z.enum([
  "returning_customer",
  "referral",
  "fleet",
  "senior",
  "military",
  "first_responder",
]);

export const createEstimateTool = {
  name: "create_estimate",
  description:
    "Generate a price estimate for services. Provide vehicle info directly (year/make/model). " +
    "If the user is a known customer, also pass customerId to save the estimate to their account. " +
    "The system automatically applies disposal fees, time surcharges, travel fees, and discounts.",
  schema: z.object({
    customerId: z
      .number()
      .optional()
      .describe(
        "Customer ID from database (if known). Omit for anonymous users.",
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
    _ctx: unknown,
  ) => {
    // 1. Resolve customer if provided
    let customer;
    if (params.customerId) {
      const [found] = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, params.customerId))
        .limit(1);
      customer = found;
    }

    // 2. Calculate service line items (labor + parts)
    const serviceItems = await Promise.all(
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
    const feeItems = buildFeeItems(config, {
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

    // 4. Combine all items
    const allItems = [...serviceItems, ...customLineItems, ...feeItems];

    // 5. Calculate subtotal before discount
    const subtotalBeforeDiscount = allItems.reduce(
      (sum, item) => sum + item.price,
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
      allItems.push({
        name: "Discount",
        description: discount.label,
        price: -discount.amount,
      });
    }

    // 7. Final subtotal (enforce minimum service fee)
    let subtotal = allItems.reduce((sum, item) => sum + item.price, 0);
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
      const [estimate] = await db
        .insert(schema.estimates)
        .values({
          customerId: customer.id,
          items: allItems,
          vehicleInfo: params.vehicle
            ? {
              year: String(params.vehicle.year),
              make: params.vehicle.make,
              model: params.vehicle.model,
            }
            : null,
          subtotal,
          priceRangeLow: rangeLow,
          priceRangeHigh: rangeHigh,
          notes: params.notes,
          shareToken,
          validDays,
          expiresAt,
        })
        .returning();

      // Auto-create order linked to this estimate
      const [order] = await db
        .insert(schema.orders)
        .values({
          customerId: customer.id,
          estimateId: estimate.id,
          status: "estimated",
          statusHistory: [
            { status: "estimated", timestamp: new Date().toISOString(), actor: "system" },
          ],
        })
        .returning();

      notifyOrderStatusChange(order.id, "estimated");

      const baseUrl = "/api/estimates";

      return toolResult({
        success: true,
        estimateId: estimate.id,
        orderId: order.id,
        vehicle: `${params.vehicle.year} ${params.vehicle.make} ${params.vehicle.model}`,
        downloadUrl: `${baseUrl}/${estimate.id}/pdf`,
        shareUrl: `${baseUrl}/${estimate.id}/pdf?token=${shareToken}`,
        items: allItems.map((i) => ({
          name: i.name,
          description: i.description,
          price: i.price / 100,
        })),
        subtotal: subtotal / 100,
        priceRange: `$${(rangeLow / 100).toFixed(2)} - $${(rangeHigh / 100).toFixed(2)}`,
        expiresAt,
      });
    }

    // Anonymous user — return pricing without saving
    return toolResult({
      success: true,
      vehicle: `${params.vehicle.year} ${params.vehicle.make} ${params.vehicle.model}`,
      items: allItems.map((i) => ({
        name: i.name,
        description: i.description,
        price: i.price / 100,
      })),
      subtotal: subtotal / 100,
      priceRange: `$${(rangeLow / 100).toFixed(2)} - $${(rangeHigh / 100).toFixed(2)}`,
      note: "Estimate not saved — customer not signed in.",
    });
  },
};

export const getEstimateTool = {
  name: "get_estimate",
  description: "Retrieve an existing estimate by ID to check status or details",
  schema: z.object({
    estimateId: z.number().describe("Estimate ID from database"),
  }),
  execute: async (params: { estimateId: number }, _ctx: unknown) => {
    const [estimate] = await db
      .select()
      .from(schema.estimates)
      .where(eq(schema.estimates.id, params.estimateId))
      .limit(1);

    if (!estimate) {
      return toolResult({ found: false, message: "Estimate not found" });
    }

    const isExpired = new Date() > estimate.expiresAt;

    return toolResult({
      found: true,
      estimate: {
        id: estimate.id,
        items: estimate.items,
        subtotal: estimate.subtotal / 100,
        priceRange: `$${(estimate.priceRangeLow / 100).toFixed(2)} - $${
          (estimate.priceRangeHigh / 100).toFixed(2)
        }`,
        notes: estimate.notes,
        expiresAt: estimate.expiresAt,
        isExpired,
        convertedToQuote: estimate.convertedToQuoteId !== null,
        downloadUrl: `/api/estimates/${estimate.id}/pdf`,
        shareUrl: `/api/estimates/${estimate.id}/pdf?token=${estimate.shareToken}`,
      },
    });
  },
};

export const estimateTools = [createEstimateTool, getEstimateTool];
