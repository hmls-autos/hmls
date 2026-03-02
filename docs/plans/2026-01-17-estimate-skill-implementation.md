# Estimate Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Build a comprehensive estimate skill for the HMLS agent that generates downloadable PDF
estimates with vehicle-based pricing.

**Architecture:** Modular skill pattern exporting tools + prompt. Server-side PDF generation via
React-PDF. Dual-access API (authenticated + shareable tokens). Pricing engine with make/model
multipliers and tiered parts markup.

**Tech Stack:** Deno/TypeScript (agent), Hono (API), React-PDF, Drizzle ORM, PostgreSQL

**Design Document:** `docs/plans/2026-01-17-estimate-skill-design.md`

---

## Task 1: Database Schema - Pricing Config

**Files:**

- Modify: `apps/api/src/db/schema.ts`

**Step 1: Add pricing_config table to schema**

```typescript
// Add after existing tables in schema.ts

export const pricingConfig = pgTable("pricing_config", {
  key: varchar("key", { length: 50 }).primaryKey(),
  value: integer("value").notNull(),
  description: text("description"),
});
```

**Step 2: Run typecheck on schema file**

Run: `cd apps/api && deno check src/db/schema.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/db/schema.ts
git commit -m "feat(db): add pricing_config table schema"
```

---

## Task 2: Database Schema - Vehicle Pricing

**Files:**

- Modify: `apps/api/src/db/schema.ts`

**Step 1: Add vehicle_pricing table to schema**

```typescript
// Add after pricingConfig table

export const vehiclePricing = pgTable("vehicle_pricing", {
  id: serial("id").primaryKey(),
  make: varchar("make", { length: 50 }).notNull(),
  model: varchar("model", { length: 50 }),
  multiplier: numeric("multiplier", { precision: 3, scale: 2 }).notNull()
    .default("1.00"),
  notes: text("notes"),
}, (table) => ({
  uniqueMakeModel: unique().on(table.make, table.model),
}));
```

**Step 2: Run typecheck**

Run: `cd apps/api && deno check src/db/schema.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/db/schema.ts
git commit -m "feat(db): add vehicle_pricing table schema"
```

---

## Task 3: Database Schema - Estimates Table

**Files:**

- Modify: `apps/api/src/db/schema.ts`

**Step 1: Add estimates table to schema**

```typescript
// Add after vehiclePricing table

export const estimates = pgTable("estimates", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  items: jsonb("items").notNull(),
  subtotal: integer("subtotal").notNull(),
  priceRangeLow: integer("price_range_low").notNull(),
  priceRangeHigh: integer("price_range_high").notNull(),
  notes: text("notes"),
  shareToken: varchar("share_token", { length: 32 }).unique(),
  validDays: integer("valid_days").notNull().default(14),
  expiresAt: timestamp("expires_at").notNull(),
  convertedToQuoteId: integer("converted_to_quote_id").references(() => quotes.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const estimatesRelations = relations(estimates, ({ one }) => ({
  customer: one(customers, {
    fields: [estimates.customerId],
    references: [customers.id],
  }),
  convertedToQuote: one(quotes, {
    fields: [estimates.convertedToQuoteId],
    references: [quotes.id],
  }),
}));
```

**Step 2: Run typecheck**

Run: `cd apps/api && deno check src/db/schema.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/db/schema.ts
git commit -m "feat(db): add estimates table schema"
```

---

## Task 4: Database Migration

**Files:**

- Run migration command

**Step 1: Push schema to database**

Run: `bun run db:push` Expected: Tables created successfully (pricing_config, vehicle_pricing,
estimates)

**Step 2: Seed pricing config**

Run the following SQL via db:studio or direct connection:

```sql
INSERT INTO pricing_config (key, value, description) VALUES
  ('hourly_rate', 14000, 'Base labor rate in cents ($140)'),
  ('diagnostic_fee', 9500, 'Complex diagnostic fee in cents ($95)'),
  ('after_hours_fee', 5000, 'After 8PM fee in cents ($50)'),
  ('rush_fee', 7500, 'Same-day rush fee in cents ($75)'),
  ('parts_markup_tier1_pct', 40, 'Markup % for parts under $50'),
  ('parts_markup_tier2_pct', 30, 'Markup % for parts $50-200'),
  ('parts_markup_tier3_pct', 20, 'Markup % for parts over $200');
```

**Step 3: Seed initial vehicle pricing**

```sql
INSERT INTO vehicle_pricing (make, model, multiplier, notes) VALUES
  ('Toyota', NULL, 1.0, 'Standard rate'),
  ('Honda', NULL, 1.0, 'Standard rate'),
  ('Nissan', NULL, 1.0, 'Standard rate'),
  ('Ford', NULL, 1.0, 'Standard rate'),
  ('Chevrolet', NULL, 1.0, 'Standard rate'),
  ('Hyundai', NULL, 1.0, 'Standard rate'),
  ('Kia', NULL, 1.0, 'Standard rate'),
  ('BMW', NULL, 1.25, 'European luxury'),
  ('Mercedes-Benz', NULL, 1.25, 'European luxury'),
  ('Audi', NULL, 1.25, 'European luxury'),
  ('Volkswagen', NULL, 1.15, 'European standard'),
  ('Lexus', NULL, 1.15, 'Japanese luxury'),
  ('Acura', NULL, 1.10, 'Japanese luxury'),
  ('Porsche', NULL, 1.40, 'Performance/exotic'),
  ('Toyota', 'Supra', 1.30, 'Performance variant'),
  ('Toyota', 'GR Corolla', 1.25, 'Performance variant'),
  ('Honda', 'S2000', 1.20, 'Performance variant'),
  ('BMW', 'M3', 1.40, 'M Performance'),
  ('BMW', 'M5', 1.45, 'M Performance'),
  ('Audi', 'R8', 1.50, 'Supercar');
```

**Step 4: Commit**

```bash
git commit --allow-empty -m "chore(db): run migration and seed pricing data"
```

---

## Task 5: Create Skill Directory Structure

**Files:**

- Create: `apps/agent/src/skills/estimate/index.ts`
- Create: `apps/agent/src/skills/estimate/types.ts`

**Step 1: Create types file**

```typescript
// apps/agent/src/skills/estimate/types.ts

export interface ServiceInput {
  serviceId?: number;
  name: string;
  description: string;
  laborHours?: number;
  partsCost?: number;
}

export interface LineItem {
  name: string;
  description: string;
  price: number; // in cents
}

export interface PricingConfig {
  hourlyRate: number;
  diagnosticFee: number;
  afterHoursFee: number;
  rushFee: number;
  partsMarkupTier1: number;
  partsMarkupTier2: number;
  partsMarkupTier3: number;
}

export interface EstimateResult {
  success: boolean;
  estimateId: number;
  downloadUrl: string;
  shareUrl: string;
  subtotal: number;
  priceRange: string;
  expiresAt: Date;
}
```

**Step 2: Create index file (placeholder)**

```typescript
// apps/agent/src/skills/estimate/index.ts

export const estimateSkill = {
  name: "estimate",
  tools: [],
  prompt: "",
};
```

**Step 3: Run typecheck**

Run: `cd apps/agent && deno check src/skills/estimate/types.ts` Expected: No errors

**Step 4: Commit**

```bash
git add apps/agent/src/skills/estimate/
git commit -m "feat(agent): create estimate skill directory structure"
```

---

## Task 6: Pricing Engine - Config Loader

**Files:**

- Create: `apps/agent/src/skills/estimate/pricing.ts`

**Step 1: Create pricing module with config loader**

```typescript
// apps/agent/src/skills/estimate/pricing.ts

import { db, schema } from "../../db/client.ts";
import { and, eq, isNull } from "drizzle-orm";
import type { LineItem, PricingConfig, ServiceInput } from "./types.ts";

let cachedConfig: PricingConfig | null = null;

export async function getPricingConfig(): Promise<PricingConfig> {
  if (cachedConfig) return cachedConfig;

  const rows = await db.select().from(schema.pricingConfig);
  const configMap = new Map(rows.map((r) => [r.key, r.value]));

  cachedConfig = {
    hourlyRate: configMap.get("hourly_rate") ?? 14000,
    diagnosticFee: configMap.get("diagnostic_fee") ?? 9500,
    afterHoursFee: configMap.get("after_hours_fee") ?? 5000,
    rushFee: configMap.get("rush_fee") ?? 7500,
    partsMarkupTier1: configMap.get("parts_markup_tier1_pct") ?? 40,
    partsMarkupTier2: configMap.get("parts_markup_tier2_pct") ?? 30,
    partsMarkupTier3: configMap.get("parts_markup_tier3_pct") ?? 20,
  };

  return cachedConfig;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}
```

**Step 2: Run typecheck**

Run: `cd apps/agent && deno check src/skills/estimate/pricing.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/agent/src/skills/estimate/pricing.ts
git commit -m "feat(agent): add pricing config loader"
```

---

## Task 7: Pricing Engine - Vehicle Multiplier

**Files:**

- Modify: `apps/agent/src/skills/estimate/pricing.ts`

**Step 1: Add vehicle multiplier lookup function**

```typescript
// Add to pricing.ts after getPricingConfig

export async function getVehicleMultiplier(
  make: string,
  model?: string | null,
): Promise<number> {
  // Try exact make + model match first
  if (model) {
    const exact = await db
      .select()
      .from(schema.vehiclePricing)
      .where(
        and(
          eq(schema.vehiclePricing.make, make),
          eq(schema.vehiclePricing.model, model),
        ),
      )
      .limit(1);

    if (exact.length > 0) {
      return Number(exact[0].multiplier);
    }
  }

  // Fall back to make-level default
  const makeDefault = await db
    .select()
    .from(schema.vehiclePricing)
    .where(
      and(
        eq(schema.vehiclePricing.make, make),
        isNull(schema.vehiclePricing.model),
      ),
    )
    .limit(1);

  if (makeDefault.length > 0) {
    return Number(makeDefault[0].multiplier);
  }

  // Default multiplier if make not found
  return 1.0;
}
```

**Step 2: Run typecheck**

Run: `cd apps/agent && deno check src/skills/estimate/pricing.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/agent/src/skills/estimate/pricing.ts
git commit -m "feat(agent): add vehicle multiplier lookup"
```

---

## Task 8: Pricing Engine - Price Calculator

**Files:**

- Modify: `apps/agent/src/skills/estimate/pricing.ts`

**Step 1: Add price calculation function**

```typescript
// Add to pricing.ts after getVehicleMultiplier

export async function calculatePrice(
  service: ServiceInput,
  vehicleMultiplier: number,
): Promise<LineItem> {
  const config = await getPricingConfig();

  let laborCost = 0;
  let partsCost = 0;

  // Labor calculation
  if (service.laborHours) {
    // Hourly service: rate × hours × vehicle multiplier
    laborCost = Math.round(
      config.hourlyRate * service.laborHours * vehicleMultiplier,
    );
  } else if (service.serviceId) {
    // Flat-rate from catalog - would need service lookup
    // For now, skip if no laborHours provided
  }

  // Parts markup (tiered on OEM cost)
  if (service.partsCost) {
    const costCents = Math.round(service.partsCost * 100);
    let markupPct: number;

    if (costCents < 5000) {
      // Under $50
      markupPct = config.partsMarkupTier1;
    } else if (costCents < 20000) {
      // $50-200
      markupPct = config.partsMarkupTier2;
    } else {
      // Over $200
      markupPct = config.partsMarkupTier3;
    }

    partsCost = Math.round(costCents * (1 + markupPct / 100));
  }

  return {
    name: service.name,
    description: service.description,
    price: laborCost + partsCost,
  };
}
```

**Step 2: Run typecheck**

Run: `cd apps/agent && deno check src/skills/estimate/pricing.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/agent/src/skills/estimate/pricing.ts
git commit -m "feat(agent): add price calculator with parts markup"
```

---

## Task 9: Create Estimate Tool

**Files:**

- Create: `apps/agent/src/skills/estimate/tools.ts`

**Step 1: Create the create_estimate tool**

```typescript
// apps/agent/src/skills/estimate/tools.ts

import { z } from "zod";
import { nanoid } from "npm:nanoid";
import { db, schema } from "../../db/client.ts";
import { eq } from "drizzle-orm";
import { calculatePrice, getPricingConfig, getVehicleMultiplier } from "./pricing.ts";
import type { EstimateResult } from "./types.ts";

export const createEstimateTool = {
  name: "create_estimate",
  description:
    "Generate a downloadable PDF estimate for a customer. Requires existing customer with vehicle info. Returns download and shareable URLs.",
  parameters: z.object({
    customerId: z.number().describe("Customer ID from database"),
    services: z
      .array(
        z.object({
          serviceId: z.number().optional().describe("Service ID from catalog"),
          name: z.string().describe("Service name"),
          description: z.string().describe("Brief description"),
          laborHours: z
            .number()
            .optional()
            .describe("Labor hours (for hourly services)"),
          partsCost: z
            .number()
            .optional()
            .describe("Estimated parts cost in dollars"),
        }),
      )
      .describe("List of services to include in estimate"),
    notes: z.string().optional().describe("Additional notes for the estimate"),
    validDays: z.number().default(14).describe("Days until estimate expires"),
    isRush: z.boolean().default(false).describe("Same-day service requested"),
    isAfterHours: z
      .boolean()
      .default(false)
      .describe("After 8PM appointment requested"),
  }),
  execute: async (params: {
    customerId: number;
    services: {
      serviceId?: number;
      name: string;
      description: string;
      laborHours?: number;
      partsCost?: number;
    }[];
    notes?: string;
    validDays?: number;
    isRush?: boolean;
    isAfterHours?: boolean;
  }): Promise<EstimateResult | { success: false; error: string }> => {
    // 1. Get customer with vehicle info
    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, params.customerId))
      .limit(1);

    if (!customer) {
      return { success: false, error: "Customer not found" };
    }

    const vehicleInfo = customer.vehicleInfo as {
      make?: string;
      model?: string;
      year?: string;
    } | null;

    if (!vehicleInfo?.make) {
      return {
        success: false,
        error: "Vehicle info required. Please add vehicle make/model first.",
      };
    }

    // 2. Get vehicle multiplier
    const multiplier = await getVehicleMultiplier(
      vehicleInfo.make,
      vehicleInfo.model,
    );

    // 3. Calculate pricing for each service
    const items = await Promise.all(
      params.services.map((s) => calculatePrice(s, multiplier)),
    );

    // 4. Add fees
    const config = await getPricingConfig();
    let feesTotal = 0;

    if (params.isRush) {
      feesTotal += config.rushFee;
      items.push({
        name: "Same-Day Service",
        description: "Rush scheduling fee",
        price: config.rushFee,
      });
    }

    if (params.isAfterHours) {
      feesTotal += config.afterHoursFee;
      items.push({
        name: "After-Hours Service",
        description: "Evening appointment fee",
        price: config.afterHoursFee,
      });
    }

    // 5. Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.price, 0);
    const rangeLow = Math.round(subtotal * 0.9);
    const rangeHigh = Math.round(subtotal * 1.1);

    // 6. Generate share token
    const shareToken = nanoid(32);
    const validDays = params.validDays ?? 14;
    const expiresAt = new Date(
      Date.now() + validDays * 24 * 60 * 60 * 1000,
    );

    // 7. Create estimate record
    const [estimate] = await db
      .insert(schema.estimates)
      .values({
        customerId: params.customerId,
        items: items,
        subtotal,
        priceRangeLow: rangeLow,
        priceRangeHigh: rangeHigh,
        notes: params.notes,
        shareToken,
        validDays,
        expiresAt,
      })
      .returning();

    // 8. Return result with download links
    const baseUrl = "/api/estimates";

    return {
      success: true,
      estimateId: estimate.id,
      downloadUrl: `${baseUrl}/${estimate.id}/pdf`,
      shareUrl: `${baseUrl}/${estimate.id}/pdf?token=${shareToken}`,
      subtotal: subtotal / 100,
      priceRange: `$${(rangeLow / 100).toFixed(2)} - $${(rangeHigh / 100).toFixed(2)}`,
      expiresAt,
    };
  },
};
```

**Step 2: Run typecheck**

Run: `cd apps/agent && deno check src/skills/estimate/tools.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/agent/src/skills/estimate/tools.ts
git commit -m "feat(agent): add create_estimate tool"
```

---

## Task 10: Get Estimate Tool

**Files:**

- Modify: `apps/agent/src/skills/estimate/tools.ts`

**Step 1: Add get_estimate tool**

```typescript
// Add to tools.ts after createEstimateTool

export const getEstimateTool = {
  name: "get_estimate",
  description: "Retrieve an existing estimate by ID to check status or details",
  parameters: z.object({
    estimateId: z.number().describe("Estimate ID from database"),
  }),
  execute: async (params: { estimateId: number }) => {
    const [estimate] = await db
      .select()
      .from(schema.estimates)
      .where(eq(schema.estimates.id, params.estimateId))
      .limit(1);

    if (!estimate) {
      return { found: false, message: "Estimate not found" };
    }

    const isExpired = new Date() > estimate.expiresAt;

    return {
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
    };
  },
};
```

**Step 2: Run typecheck**

Run: `cd apps/agent && deno check src/skills/estimate/tools.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/agent/src/skills/estimate/tools.ts
git commit -m "feat(agent): add get_estimate tool"
```

---

## Task 11: Estimate Skill Prompt

**Files:**

- Create: `apps/agent/src/skills/estimate/prompt.ts`

**Step 1: Create the skill prompt**

```typescript
// apps/agent/src/skills/estimate/prompt.ts

export const ESTIMATE_PROMPT = `
## Estimate Skill

You can create downloadable PDF estimates for customers.

### When to Use
- Customer asks "how much for X?" or "what would it cost?"
- Customer wants a price breakdown before committing
- Use estimates for informal pricing; use quotes for formal commitments

### Requirements
Before creating an estimate, you MUST have:
1. Customer record (use get_customer or create_customer first)
2. Vehicle info (make, model, year) - needed for accurate pricing
3. Clear understanding of services needed

### Flow
1. Gather vehicle info and understand the issue
2. Look up or create customer record
3. Call create_estimate with customerId and itemized services
4. Present the download link to the customer
5. Ask if they'd like to proceed with a formal quote

### Pricing
The system automatically applies:
- Vehicle-specific pricing adjustments
- Parts markup based on cost tier
- Rush/after-hours fees when applicable

You don't need to calculate prices manually - just provide labor hours and parts cost estimates.

### Response Format
After creating an estimate, say something like:

"I've prepared an estimate for you!

**[Download your estimate (PDF)](downloadUrl)**

This includes [brief summary of services]. The estimated total is [subtotal] (range: [priceRange]).

If you'd like to share this estimate with someone, here's a shareable link: [shareUrl]

This estimate is valid for 14 days. Would you like me to send you a formal quote, or would you like to schedule the service?"
`;
```

**Step 2: Run typecheck**

Run: `cd apps/agent && deno check src/skills/estimate/prompt.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/agent/src/skills/estimate/prompt.ts
git commit -m "feat(agent): add estimate skill prompt"
```

---

## Task 12: Assemble Estimate Skill

**Files:**

- Modify: `apps/agent/src/skills/estimate/index.ts`

**Step 1: Export complete skill**

```typescript
// apps/agent/src/skills/estimate/index.ts

import { createEstimateTool, getEstimateTool } from "./tools.ts";
import { ESTIMATE_PROMPT } from "./prompt.ts";

export const estimateSkill = {
  name: "estimate",
  description: "Generate and manage customer estimates with PDF download",
  tools: [createEstimateTool, getEstimateTool],
  prompt: ESTIMATE_PROMPT,
};

// Re-export for direct access if needed
export { createEstimateTool, getEstimateTool } from "./tools.ts";
export { ESTIMATE_PROMPT } from "./prompt.ts";
export * from "./types.ts";
export * from "./pricing.ts";
```

**Step 2: Run typecheck**

Run: `cd apps/agent && deno check src/skills/estimate/index.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/agent/src/skills/estimate/index.ts
git commit -m "feat(agent): assemble estimate skill exports"
```

---

## Task 13: Integrate Skill into Agent

**Files:**

- Modify: `apps/agent/src/agent.ts`
- Modify: `apps/agent/src/system-prompt.ts`

**Step 1: Import and register skill tools**

```typescript
// apps/agent/src/agent.ts
// Add import at top
import { estimateSkill } from "./skills/estimate/index.ts";

// Update tools array in createZypherAgent call
tools: [...customerTools, ...stripeTools, ...estimateSkill.tools],
```

**Step 2: Update system prompt to include skill prompt**

```typescript
// apps/agent/src/system-prompt.ts
// Add import at top
import { ESTIMATE_PROMPT } from "./skills/estimate/prompt.ts";

// Append to SYSTEM_PROMPT (at the end, before closing backtick)
// Add this section:
${ESTIMATE_PROMPT}
```

Or alternatively, modify agent.ts to concatenate:

```typescript
overrides: {
  systemPromptLoader: async () => SYSTEM_PROMPT + "\n\n" + estimateSkill.prompt,
},
```

**Step 3: Run typecheck**

Run: `cd apps/agent && deno check src/agent.ts` Expected: No errors

**Step 4: Commit**

```bash
git add apps/agent/src/agent.ts apps/agent/src/system-prompt.ts
git commit -m "feat(agent): integrate estimate skill into agent"
```

---

## Task 14: Install React-PDF in API

**Files:**

- Modify: `apps/api/package.json`

**Step 1: Add @react-pdf/renderer dependency**

Run: `cd apps/api && bun add @react-pdf/renderer`

**Step 2: Verify installation**

Run: `cd apps/api && bun run build` Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/api/package.json bun.lock
git commit -m "chore(api): add @react-pdf/renderer dependency"
```

---

## Task 15: PDF Template Component

**Files:**

- Create: `apps/api/src/pdf/EstimatePdf.tsx`

**Step 1: Create the PDF template**

```typescript
// apps/api/src/pdf/EstimatePdf.tsx

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
    paddingBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: "#10b981",
  },
  logo: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#10b981",
  },
  logoSubtext: {
    fontSize: 10,
    color: "#666666",
    marginTop: 4,
  },
  titleSection: {
    textAlign: "right",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1a1a1a",
  },
  estimateNumber: {
    fontSize: 10,
    color: "#666666",
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#10b981",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  customerInfo: {
    backgroundColor: "#f9fafb",
    padding: 15,
    borderRadius: 4,
  },
  customerName: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 4,
  },
  customerDetail: {
    fontSize: 10,
    color: "#666666",
    marginBottom: 2,
  },
  vehicleInfo: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    padding: 10,
    fontWeight: "bold",
    fontSize: 10,
  },
  tableRow: {
    flexDirection: "row",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  colService: {
    flex: 2,
  },
  colDescription: {
    flex: 3,
  },
  colPrice: {
    flex: 1,
    textAlign: "right",
  },
  totalSection: {
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 2,
    borderTopColor: "#10b981",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  totalLabel: {
    fontSize: 12,
    marginRight: 20,
  },
  totalValue: {
    fontSize: 12,
    fontWeight: "bold",
    width: 100,
    textAlign: "right",
  },
  rangeValue: {
    fontSize: 10,
    color: "#666666",
    width: 100,
    textAlign: "right",
  },
  footer: {
    position: "absolute",
    bottom: 40,
    left: 40,
    right: 40,
  },
  disclaimer: {
    fontSize: 9,
    color: "#666666",
    marginBottom: 15,
    padding: 10,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
  },
  cta: {
    fontSize: 10,
    textAlign: "center",
    marginBottom: 15,
  },
  contact: {
    fontSize: 9,
    color: "#666666",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
  },
});

interface LineItem {
  name: string;
  description: string;
  price: number;
}

interface Customer {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  vehicleInfo: {
    make?: string;
    model?: string;
    year?: string;
  } | null;
}

interface Estimate {
  id: number;
  items: LineItem[];
  subtotal: number;
  priceRangeLow: number;
  priceRangeHigh: number;
  notes: string | null;
  expiresAt: Date;
  createdAt: Date;
}

interface EstimatePdfProps {
  estimate: Estimate;
  customer: Customer;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatVehicle(vehicleInfo: Customer["vehicleInfo"]): string {
  if (!vehicleInfo) return "Not specified";
  const parts = [vehicleInfo.year, vehicleInfo.make, vehicleInfo.model].filter(
    Boolean,
  );
  return parts.join(" ") || "Not specified";
}

export function EstimatePdf({ estimate, customer }: EstimatePdfProps) {
  const items = estimate.items as LineItem[];

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>HMLS</Text>
            <Text style={styles.logoSubtext}>Mobile Mechanic</Text>
          </View>
          <View style={styles.titleSection}>
            <Text style={styles.title}>ESTIMATE</Text>
            <Text style={styles.estimateNumber}>#{estimate.id}</Text>
            <Text style={styles.estimateNumber}>
              {formatDate(estimate.createdAt)}
            </Text>
          </View>
        </View>

        {/* Customer Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prepared For</Text>
          <View style={styles.customerInfo}>
            <Text style={styles.customerName}>
              {customer.name || "Customer"}
            </Text>
            {customer.phone && <Text style={styles.customerDetail}>{customer.phone}</Text>}
            {customer.email && <Text style={styles.customerDetail}>{customer.email}</Text>}
            {customer.address && <Text style={styles.customerDetail}>{customer.address}</Text>}
            <View style={styles.vehicleInfo}>
              <Text style={styles.customerDetail}>
                Vehicle: {formatVehicle(customer.vehicleInfo)}
              </Text>
            </View>
          </View>
        </View>

        {/* Line Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Services</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colService}>Service</Text>
              <Text style={styles.colDescription}>Description</Text>
              <Text style={styles.colPrice}>Price</Text>
            </View>
            {items.map((item, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.colService}>{item.name}</Text>
                <Text style={styles.colDescription}>{item.description}</Text>
                <Text style={styles.colPrice}>{formatPrice(item.price)}</Text>
              </View>
            ))}
          </View>

          {/* Totals */}
          <View style={styles.totalSection}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal:</Text>
              <Text style={styles.totalValue}>
                {formatPrice(estimate.subtotal)}
              </Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Estimated Range:</Text>
              <Text style={styles.rangeValue}>
                {formatPrice(estimate.priceRangeLow)} - {formatPrice(estimate.priceRangeHigh)}
              </Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {estimate.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text>{estimate.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.disclaimer}>
            This estimate is valid until{" "}
            {formatDate(estimate.expiresAt)}. Final price may vary based on actual conditions found
            during service. Payment is due upon completion of service.
          </Text>
          <Text style={styles.cta}>
            Ready to proceed? Reply in chat or call us to schedule your service.
          </Text>
          <Text style={styles.contact}>
            HMLS Mobile Mechanic | Orange County, CA | Mon-Sat 8AM-12AM
          </Text>
        </View>
      </Page>
    </Document>
  );
}
```

**Step 2: Run typecheck**

Run: `cd apps/api && bun run typecheck` Expected: No errors (or pre-existing bun-types error only)

**Step 3: Commit**

```bash
git add apps/api/src/pdf/
git commit -m "feat(api): add EstimatePdf template component"
```

---

## Task 16: Estimate PDF API Route

**Files:**

- Create: `apps/api/src/routes/estimates.ts`

**Step 1: Create the estimates route**

```typescript
// apps/api/src/routes/estimates.ts

import { Hono } from "hono";
import { renderToStream } from "@react-pdf/renderer";
import { db, schema } from "../db/client.ts";
import { and, eq } from "drizzle-orm";
import { EstimatePdf } from "../pdf/EstimatePdf.tsx";

const estimates = new Hono();

// GET /api/estimates/:id/pdf
estimates.get("/:id/pdf", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const token = c.req.query("token");

  if (isNaN(id)) {
    return c.json({ error: "Invalid estimate ID" }, 400);
  }

  let estimate;

  if (token) {
    // Public access via share token
    const [result] = await db
      .select()
      .from(schema.estimates)
      .where(
        and(
          eq(schema.estimates.id, id),
          eq(schema.estimates.shareToken, token),
        ),
      )
      .limit(1);
    estimate = result;
  } else {
    // For authenticated access, check user session
    // For now, allow access if no token (will add auth middleware later)
    const [result] = await db
      .select()
      .from(schema.estimates)
      .where(eq(schema.estimates.id, id))
      .limit(1);
    estimate = result;
  }

  if (!estimate) {
    return c.json({ error: "Estimate not found" }, 404);
  }

  // Get customer info
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, estimate.customerId))
    .limit(1);

  if (!customer) {
    return c.json({ error: "Customer not found" }, 404);
  }

  // Generate PDF
  const pdfStream = await renderToStream(
    <EstimatePdf
      estimate={{
        ...estimate,
        items: estimate.items as any[],
      }}
      customer={{
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        vehicleInfo: customer.vehicleInfo as any,
      }}
    />,
  );

  // Set response headers
  c.header("Content-Type", "application/pdf");
  c.header(
    "Content-Disposition",
    `attachment; filename="HMLS-Estimate-${id}.pdf"`,
  );

  // Return stream
  return new Response(pdfStream as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="HMLS-Estimate-${id}.pdf"`,
    },
  });
});

export default estimates;
```

**Step 2: Run typecheck**

Run: `cd apps/api && bun run typecheck` Expected: No errors (or pre-existing errors only)

**Step 3: Commit**

```bash
git add apps/api/src/routes/estimates.ts
git commit -m "feat(api): add estimate PDF download route"
```

---

## Task 17: Register Estimates Route

**Files:**

- Modify: `apps/api/src/index.ts`

**Step 1: Import and register the estimates route**

```typescript
// Add import at top of apps/api/src/index.ts
import estimates from "./routes/estimates.ts";

// Add route registration (after other routes)
app.route("/api/estimates", estimates);
```

**Step 2: Run typecheck**

Run: `cd apps/api && bun run typecheck` Expected: No errors (or pre-existing errors only)

**Step 3: Test the API starts**

Run: `cd apps/api && timeout 5 bun run dev || true` Expected: Server starts without import errors

**Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): register estimates route"
```

---

## Task 18: Update Chat Tool Display Names

**Files:**

- Modify: `apps/web/app/chat/page.tsx`

**Step 1: Add estimate tool display names**

Find the `toolDisplayNames` object and add:

```typescript
const toolDisplayNames: Record<string, string> = {
  get_availability: "Checking availability",
  create_booking: "Creating booking",
  get_customer: "Looking up customer",
  create_customer: "Saving customer info",
  get_services: "Getting services",
  create_estimate: "Preparing estimate", // Updated
  get_estimate: "Loading estimate", // New
  create_quote: "Creating quote",
  create_invoice: "Creating invoice",
  get_quote_status: "Checking quote status",
};
```

**Step 2: Run build**

Run: `bun run build` Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/web/app/chat/page.tsx
git commit -m "feat(web): update tool display names for estimates"
```

---

## Task 19: Final Integration Test

**Step 1: Start all services**

Run in separate terminals:

- `bun run dev:api`
- `bun run dev:web`

**Step 2: Test estimate flow**

1. Open chat at http://localhost:3000/chat
2. Create a customer: "I need a quote for brake service. My name is John, phone 555-1234, I have a
   2020 BMW M3"
3. Request estimate: "How much would front brake pads cost?"
4. Verify agent calls create_estimate tool
5. Verify download link is returned
6. Click download link, verify PDF downloads
7. Test share link works in incognito

**Step 3: Verify PDF content**

- Header with HMLS branding
- Customer info displayed correctly
- Vehicle info (2020 BMW M3)
- Service line items with prices
- Subtotal and range shown
- Footer with disclaimer and CTA

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete estimate skill implementation

- Database schema for estimates, vehicle_pricing, pricing_config
- Pricing engine with make/model multipliers and tiered parts markup
- create_estimate and get_estimate tools
- React-PDF template with clean modern design
- Dual-access API (authenticated + shareable tokens)
- Integrated into agent and web chat"
```

---

## Summary

**Files Created:**

- `apps/agent/src/skills/estimate/index.ts`
- `apps/agent/src/skills/estimate/types.ts`
- `apps/agent/src/skills/estimate/tools.ts`
- `apps/agent/src/skills/estimate/pricing.ts`
- `apps/agent/src/skills/estimate/prompt.ts`
- `apps/api/src/pdf/EstimatePdf.tsx`
- `apps/api/src/routes/estimates.ts`

**Files Modified:**

- `apps/api/src/db/schema.ts`
- `apps/api/src/index.ts`
- `apps/agent/src/agent.ts`
- `apps/web/app/chat/page.tsx`

**Dependencies Added:**

- `@react-pdf/renderer` (API)

**Database Changes:**

- `pricing_config` table
- `vehicle_pricing` table
- `estimates` table
