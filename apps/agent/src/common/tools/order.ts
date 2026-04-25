// apps/agent/src/common/tools/order.ts
//
// Unified order creation/update tool. Replaces the old `create_estimate` and
// `create_order` tools — orders is the single source of truth, so a single
// "upsert with full pricing engine" tool covers both customer- and staff-side
// flows.
//
// Idempotency: pass `orderId` to update an existing draft/revised/estimated
// order in place (re-runs the full pricing engine). Without `orderId`, inserts
// a new draft. Updating an `estimated` order auto-flips it back to `revised`,
// matching the existing modify_order_items semantics.

import { z } from "zod";
import { eq, ilike } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getLogger } from "@logtape/logtape";
import { db, schema } from "../../db/client.ts";
import {
  buildFeeItems,
  calculateDiscount,
  calculatePrice,
  getPricingConfig,
} from "../../hmls/skills/estimate/pricing.ts";
import { toolResult } from "@hmls/shared/tool-result";
import type { DiscountType, LineItem, ServiceInput } from "../../hmls/skills/estimate/types.ts";
import type { OrderItem } from "../../db/schema.ts";
import { findVehicles, searchLaborTimes } from "../../hmls/tools/olp-client.ts";
import { lookupPartsPrice } from "./parts-lookup.ts";
import { patchItems } from "../../services/order-state.ts";
import {
  customerAgentActor,
  staffAgentActor,
  toolResultFromOrderState,
} from "../../services/order-state-tool.ts";
import type { ToolContext } from "../convert-tools.ts";

const logger = getLogger(["hmls", "agent", "create_order"]);

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

type CustomerRecord = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
};

/**
 * Resolve the customer for this order in priority order:
 *  1. Auth context (customer chat) — never overrideable by the model
 *  2. Explicit `customerId` (staff for known customer)
 *  3. `customerInfo` lookup-by-email or create-as-guest (staff walk-in)
 *  4. null (orphan order — staff can attach a customer later)
 */
async function resolveCustomer(
  ctxCustomerId: number | undefined,
  paramCustomerId: number | undefined,
  customerInfo: { name?: string; email?: string; phone?: string } | undefined,
): Promise<CustomerRecord | null> {
  const id = ctxCustomerId ?? paramCustomerId;
  if (id) {
    const [found] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, id))
      .limit(1);
    return found ?? null;
  }

  if (!customerInfo) return null;
  const { name, email, phone } = customerInfo;
  if (!name && !email && !phone) return null;

  if (email) {
    const [existing] = await db
      .select()
      .from(schema.customers)
      .where(ilike(schema.customers.email, email))
      .limit(1);
    if (existing) return existing;
  }

  const [created] = await db
    .insert(schema.customers)
    .values({
      name: name ?? null,
      email: email ?? null,
      phone: phone ?? null,
    })
    .returning();
  return created ?? null;
}

// ---------------------------------------------------------------------------
// Pricing — shared between insert and update paths
// ---------------------------------------------------------------------------

interface PriceServicesInput {
  services: ServiceInput[];
  customItems?: { name: string; description: string; price: number }[];
  isRush?: boolean;
  isAfterHours?: boolean;
  isEarlyMorning?: boolean;
  isWeekend?: boolean;
  isSunday?: boolean;
  isHoliday?: boolean;
  travelMiles?: number;
  discountType?: DiscountType;
  vehicle?: { year: number; make: string; model: string };
  /** Customer-side: pricing is server-determined. We override
   *  laborHours from OLP, drop partsCost (shop adds parts on review),
   *  and the caller has already stripped customItems / discount / fee
   *  flags. A prompt-injecting customer cannot quote themselves a
   *  cheaper price — every dollar comes from OLP or shop config. */
  customerSide?: boolean;
}

/** Resolve laborHours for a service from OLP. Returns null if no match.
 *  Tries the service name as-is first, then a fuzzy vehicle lookup. */
async function olpLaborHours(
  vehicle: { year: number; make: string; model: string },
  serviceName: string,
): Promise<number | null> {
  try {
    let vehicles = await findVehicles(vehicle.make, vehicle.model, vehicle.year);
    if (vehicles.length === 0) {
      vehicles = await findVehicles(vehicle.make, vehicle.model, vehicle.year, true);
    }
    if (vehicles.length === 0) return null;
    const words = serviceName.split(/\s+/).filter((w) => w.length > 1);
    if (words.length === 0) return null;
    const hits = await searchLaborTimes(
      vehicles.map((v) => v.id),
      words,
      undefined,
    );
    if (hits.length === 0) return null;
    const hours = Number(hits[0].labor_hours);
    return Number.isFinite(hours) && hours > 0 ? hours : null;
  } catch (err) {
    logger.warn("olpLaborHours lookup failed", { err: String(err) });
    return null;
  }
}

/** Resolve partsCost for a service from RockAuto. Returns null when the
 *  service name doesn't map to a known part type (e.g. inspection, tire
 *  rotation) or RockAuto has no listing — those orders draft with
 *  partsCost=null and the shop fills in real parts pricing on review. */
async function rockautoPartsCost(
  vehicle: { year: number; make: string; model: string },
  serviceName: string,
): Promise<number | null> {
  try {
    const result = await lookupPartsPrice.execute(
      {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        partName: serviceName,
      },
      undefined,
    );
    // toolResult returns either { content: [{ text: JSON }] } or {} —
    // parse the JSON and pull recommendedPrice.
    const text = (result as { content?: Array<{ text?: string }> })
      ?.content?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as { recommendedPrice?: number };
    return typeof parsed.recommendedPrice === "number" && parsed.recommendedPrice > 0
      ? parsed.recommendedPrice
      : null;
  } catch (err) {
    logger.warn("rockautoPartsCost lookup failed", { err: String(err) });
    return null;
  }
}

/** Replace LLM-supplied laborHours / partsCost with values looked up
 *  directly from OLP / RockAuto. The customer agent CANNOT influence
 *  pricing — every dollar comes from a database lookup or is left
 *  blank for the shop to fill on review. */
async function lookupServerSidePricing(
  services: ServiceInput[],
  vehicle: { year: number; make: string; model: string } | undefined,
): Promise<ServiceInput[]> {
  if (!vehicle) {
    return services.map((s) => ({ ...s, laborHours: undefined, partsCost: undefined }));
  }
  return await Promise.all(
    services.map(async (s) => {
      const [labor, parts] = await Promise.all([
        olpLaborHours(vehicle, s.name),
        rockautoPartsCost(vehicle, s.name),
      ]);
      return {
        ...s,
        laborHours: labor ?? undefined,
        partsCost: parts ?? undefined,
      };
    }),
  );
}

async function priceServices(input: PriceServicesInput): Promise<{
  items: OrderItem[];
  subtotal: number;
  rangeLow: number;
  rangeHigh: number;
}> {
  const services = input.customerSide
    ? await lookupServerSidePricing(input.services, input.vehicle)
    : input.services;
  const serviceLineItems = await Promise.all(
    services.map((s) => calculatePrice(s)),
  );

  const customLineItems: LineItem[] = (input.customItems ?? []).map((c) => ({
    name: c.name,
    description: c.description,
    price: Math.round(c.price * 100),
  }));

  const config = await getPricingConfig();
  const laborCents = services.reduce(
    (sum, s) => sum + Math.round((s.laborHours ?? 0) * config.hourlyRate),
    0,
  );

  const feeLineItems = buildFeeItems(config, {
    isRush: input.isRush,
    isAfterHours: input.isAfterHours,
    isWeekend: input.isWeekend,
    isSunday: input.isSunday,
    isHoliday: input.isHoliday,
    isEarlyMorning: input.isEarlyMorning,
    travelMiles: input.travelMiles,
    totalLaborCents: laborCents,
    services,
  });

  const items: OrderItem[] = [
    ...serviceLineItems.map((li, i) =>
      toOrderItem(li, "labor", { laborHours: services[i]?.laborHours })
    ),
    ...customLineItems.map((li) => toOrderItem(li, "labor")),
    ...feeLineItems.map((li) => toOrderItem(li, "fee")),
  ];

  const subtotalBeforeDiscount = items.reduce((sum, i) => sum + i.totalCents, 0);
  const discount = calculateDiscount(
    config,
    subtotalBeforeDiscount,
    input.discountType,
    services.length,
  );

  if (discount && discount.amount > 0) {
    items.push({
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

  let subtotal = items.reduce((sum, i) => sum + i.totalCents, 0);
  if (subtotal < config.minimumServiceFee) {
    subtotal = config.minimumServiceFee;
  }

  return {
    items,
    subtotal,
    rangeLow: Math.round(subtotal * 0.9),
    rangeHigh: Math.round(subtotal * 1.1),
  };
}

// ---------------------------------------------------------------------------
// create_order — INSERT new draft, or UPDATE existing draft/revised/estimated
// ---------------------------------------------------------------------------

export const createOrderTool = {
  name: "create_order",
  description:
    "Create a new draft order, OR update an existing draft/revised/estimated order in place. " +
    "This is the only tool for full-pricing-engine writes — it auto-applies disposal/hazmat/" +
    "battery/travel/time surcharges and discounts.\n\n" +
    "USAGE: omit `orderId` to create a new draft. Pass `orderId` to revise an order you already " +
    "created in this conversation — the row is updated in place (NOT duplicated). Updating an " +
    "'estimated' order automatically flips it back to 'revised' so the shop re-reviews.\n\n" +
    "DO NOT call this tool again with the same vehicle in the same conversation without passing " +
    "the orderId from your previous call. For incremental tweaks (add one item, fix the customer's " +
    "phone), prefer `update_order_items` / `update_order` — they're cheaper and don't re-run the " +
    "full pricing engine.",
  schema: z.object({
    orderId: z
      .number()
      .int()
      .optional()
      .describe(
        "Order ID to UPDATE in place (must be in draft/revised/estimated). Omit to INSERT new draft.",
      ),
    customerId: z
      .number()
      .int()
      .optional()
      .describe(
        "Existing customer ID. Customer chats: omit (auth context wins). Staff: pass for known customers.",
      ),
    customerInfo: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      })
      .optional()
      .describe(
        "Staff walk-in fallback: name/email/phone to find-or-create a guest customer when no customerId is known.",
      ),
    vehicle: z
      .object({
        year: z.number().describe("Vehicle year, e.g. 2015"),
        make: z.string().describe("Vehicle make, e.g. 'Honda'"),
        model: z.string().describe("Vehicle model, e.g. 'Civic'"),
      })
      .describe("Vehicle the order is for"),
    services: z
      .array(
        z.object({
          name: z.string().describe("Service name"),
          description: z.string().describe("Brief description"),
          laborHours: z
            .number()
            .optional()
            .describe("Labor hours from OLP lookup, or your best estimate"),
          partsCost: z
            .number()
            .optional()
            .describe("Estimated parts cost in dollars"),
          involvesHazmat: z
            .boolean()
            .default(false)
            .describe("True for oil/coolant/brake-fluid/etc. services"),
          tireCount: z
            .number()
            .optional()
            .describe("Number of tires being disposed"),
          involvesBattery: z
            .boolean()
            .default(false)
            .describe("True if service involves battery replacement"),
        }),
      )
      .describe("Services to include in the order"),
    customItems: z
      .array(
        z.object({
          name: z.string().describe("Item name (e.g. 'Diagnostic Fee')"),
          description: z.string().describe("Brief description"),
          price: z.number().describe("Price in dollars"),
        }),
      )
      .optional()
      .describe("Flat-rate items that bypass the labor/parts engine"),
    notes: z.string().optional().describe("Order notes"),
    validDays: z
      .number()
      .default(14)
      .describe("Days until the order's share token expires"),

    // Scheduling-related fee flags
    isRush: z.boolean().default(false),
    isAfterHours: z.boolean().default(false),
    isEarlyMorning: z.boolean().default(false),
    isWeekend: z.boolean().default(false),
    isSunday: z.boolean().default(false),
    isHoliday: z.boolean().default(false),

    travelMiles: z
      .number()
      .optional()
      .describe("Distance to customer in miles (first 15 free, then $1/mi)"),

    discountType: discountEnum.optional(),
  }),
  execute: async (
    params: {
      orderId?: number;
      customerId?: number;
      customerInfo?: { name?: string; email?: string; phone?: string };
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
    ctx: ToolContext | undefined,
  ) => {
    // Customer-side guard: drop everything a customer could use to
    // self-determine pricing (flat-rate items, discount, fee flags),
    // and force OLP-based labor + drop parts inside priceServices.
    // Staff agent keeps full access — dispatcher applies these
    // intentionally.
    const isCustomerSide = customerAgentActor(ctx) != null;
    if (isCustomerSide) {
      params = {
        ...params,
        customItems: undefined,
        discountType: undefined,
        isRush: false,
        isAfterHours: false,
        isEarlyMorning: false,
        isWeekend: false,
        isSunday: false,
        isHoliday: false,
        travelMiles: undefined,
      };
    }

    // 1. Run the pricing engine first (cheap, side-effect-free).
    const { items, subtotal, rangeLow, rangeHigh } = await priceServices({
      ...params,
      customerSide: isCustomerSide,
      vehicle: params.vehicle,
    });

    const vehicleInfo = {
      year: String(params.vehicle.year),
      make: params.vehicle.make,
      model: params.vehicle.model,
    };

    // ─────────────────────────────────────────────────────────────────
    // UPDATE path — orderId provided. Routes through the harness's
    // patchItems so status/events/notifications all flow through the
    // single source of truth. The pricing engine (priceServices above)
    // applies a minimum-service-fee floor that items.reduce() wouldn't
    // capture — pass subtotal as `subtotalCentsOverride` to preserve it.
    // ─────────────────────────────────────────────────────────────────
    if (params.orderId !== undefined) {
      const actor = customerAgentActor(ctx) ?? staffAgentActor(ctx);
      const result = await patchItems(
        params.orderId,
        {
          items,
          notes: params.notes ?? undefined,
          vehicleInfo,
        },
        actor,
        {
          subtotalCentsOverride: subtotal,
          metadata: {
            source: "create_order_update",
            itemCount: items.length,
          },
        },
      );

      return toolResultFromOrderState(result, (row) => ({
        action: "updated",
        orderId: row.id,
        status: row.status,
        version: row.revisionNumber,
        vehicle: `${params.vehicle.year} ${params.vehicle.make} ${params.vehicle.model}`,
        items: items.map((i) => ({
          name: i.name,
          description: i.description,
          unitPriceCents: i.unitPriceCents,
          totalCents: i.totalCents,
          quantity: i.quantity,
          category: i.category,
        })),
        subtotal: subtotal / 100,
        priceRange: `$${(rangeLow / 100).toFixed(2)} - $${(rangeHigh / 100).toFixed(2)}`,
        note: row.status === "revised"
          ? "Order was already sent to customer — flipped back to 'revised'. Shop must re-send."
          : "Order updated in place.",
      }));
    }

    // ─────────────────────────────────────────────────────────────────
    // INSERT path — new draft
    // ─────────────────────────────────────────────────────────────────
    const customer = await resolveCustomer(
      ctx?.customerId,
      params.customerId,
      params.customerInfo,
    );

    const shareToken = nanoid(32);
    const validDays = params.validDays ?? 14;
    const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);

    const [order] = await db
      .insert(schema.orders)
      .values({
        customerId: customer?.id ?? null,
        status: "draft",
        statusHistory: [
          { status: "draft", timestamp: new Date().toISOString(), actor: "agent" },
        ],
        items,
        notes: params.notes ?? null,
        subtotalCents: subtotal,
        priceRangeLowCents: rangeLow,
        priceRangeHighCents: rangeHigh,
        vehicleInfo,
        shareToken,
        validDays,
        expiresAt,
        contactName: customer?.name ?? null,
        contactEmail: customer?.email ?? null,
        contactPhone: customer?.phone ?? null,
        contactAddress: customer?.address ?? null,
      })
      .returning();

    await db.insert(schema.orderEvents).values({
      orderId: order.id,
      eventType: "status_change",
      fromStatus: null,
      toStatus: "draft",
      actor: "agent",
      metadata: {
        source: "create_order_insert",
        vehicleInfo,
        itemCount: items.length,
      },
    });

    return toolResult({
      success: true,
      action: "created",
      orderId: order.id,
      status: "draft",
      pendingReview: true,
      vehicle: `${params.vehicle.year} ${params.vehicle.make} ${params.vehicle.model}`,
      customerName: customer?.name ?? null,
      items: items.map((i) => ({
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
      note: "Draft order saved for shop team review. To revise this same order later in the " +
        "conversation, call create_order again with this orderId — do NOT create a new one.",
    });
  },
};

// ---------------------------------------------------------------------------
// get_order — read an order by ID
// ---------------------------------------------------------------------------

export const getOrderTool = {
  name: "get_order",
  description: "Retrieve an existing order by ID. Returns status, items, totals, and metadata.",
  schema: z.object({
    orderId: z.number().int().describe("Order ID"),
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

export const orderTools = [createOrderTool, getOrderTool];
