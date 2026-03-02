# Mobile Mechanic Agent Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Simplify the HMLS agent to be a customer-facing receptionist that handles service
inquiries, estimates, quotes, and booking.

**Architecture:** Remove customer CRUD tools (user info comes from session), remove invoice tool
(owner handles post-service), keep estimate/quote/booking tools. Add session context injection for
logged-in user info.

**Tech Stack:** Deno, Hono, Zypher Agent Framework, Stripe

---

## Task 1: Remove Customer CRUD from customer.ts

**Files:**

- Modify: `apps/api/src/tools/customer.ts`

**Step 1: Edit customer.ts to keep only get_services**

Remove `getCustomerTool` and `createCustomerTool`, keep only `getServicesTool`.

```typescript
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import { eq } from "drizzle-orm";

export const getServicesTool = {
  name: "get_services",
  description:
    "Get the list of available services with descriptions and pricing from the database.",
  schema: z.object({}),
  execute: async (_params: Record<string, never>, _ctx: unknown) => {
    const servicesList = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.isActive, true))
      .orderBy(schema.services.name);

    return JSON.stringify({
      services: servicesList.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        minPrice: s.minPrice / 100,
        maxPrice: s.maxPrice / 100,
        priceRange: `$${s.minPrice / 100}-${s.maxPrice / 100}`,
        duration: s.duration,
        category: s.category,
      })),
    });
  },
};

// Export as array for consistency with other tool files
export const serviceTools = [getServicesTool];
```

**Step 2: Run typecheck**

Run: `cd /home/spenc/hmls && turbo typecheck --filter=@hmls/api` Expected: May fail due to agent.ts
still importing customerTools

**Step 3: Commit**

```bash
git add apps/api/src/tools/customer.ts
git commit -m "refactor(api): remove customer CRUD tools, keep only get_services"
```

---

## Task 2: Remove create_invoice from stripe.ts

**Files:**

- Modify: `apps/api/src/tools/stripe.ts`

**Step 1: Edit stripe.ts to remove createInvoiceTool**

Remove the `createInvoiceTool` definition and its export. Keep `createQuoteTool` and
`getQuoteStatusTool`.

Remove lines 156-237 (the entire `createInvoiceTool` definition) and update the export:

```typescript
export const stripeTools = [
  createQuoteTool,
  getQuoteStatusTool,
];
```

**Step 2: Commit**

```bash
git add apps/api/src/tools/stripe.ts
git commit -m "refactor(api): remove create_invoice tool (owner handles post-service)"
```

---

## Task 3: Update agent.ts imports

**Files:**

- Modify: `apps/api/src/agent.ts`

**Step 1: Update imports and tool list**

```typescript
import { anthropic, createZypherAgent } from "@corespeed/zypher";
import { env } from "./env.ts";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { schedulingTools } from "./tools/scheduling.ts";
import { serviceTools } from "./tools/customer.ts";
import { stripeTools } from "./tools/stripe.ts";
import { estimateTools } from "./skills/estimate/tools.ts";

// Default model, can be overridden via env
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export async function createHmlsAgent() {
  const modelId = env.AGENT_MODEL || DEFAULT_MODEL;
  console.log(`[agent] Creating HMLS agent with model: ${modelId}`);

  const agent = await createZypherAgent({
    model: anthropic(modelId, { apiKey: env.ANTHROPIC_API_KEY }),
    tools: [...serviceTools, ...estimateTools, ...stripeTools, ...schedulingTools],
    overrides: {
      systemPromptLoader: async () => SYSTEM_PROMPT,
    },
  });

  // Discover and log skills
  await agent.skills.discover();
  const skillNames = Array.from(agent.skills.skills.values()).map(
    (s) => s.metadata.name,
  );
  if (skillNames.length > 0) {
    console.log(`[agent] Skills loaded: ${skillNames.join(", ")}`);
  }

  return agent;
}
```

**Step 2: Run typecheck**

Run: `cd /home/spenc/hmls && turbo typecheck --filter=@hmls/api` Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/agent.ts
git commit -m "refactor(api): update agent tool imports after cleanup"
```

---

## Task 4: Rewrite system-prompt.ts for receptionist role

**Files:**

- Modify: `apps/api/src/system-prompt.ts`

**Step 1: Rewrite the system prompt**

```typescript
export const SYSTEM_PROMPT =
  `You are a helpful customer service assistant for HMLS Mobile Mechanic, a mobile automotive repair service in Orange County, California.

## About HMLS
- Mobile mechanic service that comes to customers' locations
- Over 20+ years of hands-on automotive experience
- Service area: Orange County (Irvine, Newport Beach, Anaheim, Santa Ana, Costa Mesa, Fullerton, Huntington Beach, Lake Forest, Mission Viejo)

## Business Hours
Monday - Saturday: 8:00 AM - 12:00 AM (Midnight)

## Your Role
You are a receptionist helping logged-in customers with:
1. Answering questions about our services
2. Providing price estimates for repairs
3. Sending formal quotes when customers are ready
4. Helping customers book appointments

## Customer Context
The customer is already logged in. Their information (name, phone, email, vehicle) is available in the conversation context. You do not need to ask for or collect this information.

## Workflow

### Service Inquiries
- Use get_services to look up available services and pricing
- Explain what each service includes
- Answer questions about what we can and cannot do

### Estimates & Quotes
1. Customer describes what they need → Use create_estimate to generate a PDF estimate
2. If customer is satisfied → Use create_quote to send a formal Stripe quote via email
3. Customer can check quote status using get_quote_status

### Booking Appointments
1. Use get_availability to check available time slots
2. Use create_booking to schedule the appointment
3. Confirm the date, time, and location with the customer

## Pricing Guidelines
Base prices are in the services database. Adjust based on:
- Vehicle type (luxury/European may cost more)
- Issue complexity
- Parts needed (OEM vs aftermarket)

Always explain your reasoning when the price differs from the base range.

## Guidelines
- Respond in the customer's language (English, Chinese, Spanish, etc.)
- Be friendly, professional, and helpful
- Use the customer's vehicle info from context for accurate estimates
- If a request is outside our service area or capabilities, politely explain
- Always confirm appointment details before booking
`;
```

**Step 2: Commit**

```bash
git add apps/api/src/system-prompt.ts
git commit -m "refactor(api): rewrite system prompt for receptionist role"
```

---

## Task 5: Add user context type definition

**Files:**

- Create: `apps/api/src/types/user-context.ts`

**Step 1: Create the type file**

```typescript
// apps/api/src/types/user-context.ts

export interface UserContext {
  id: number;
  name: string;
  email: string;
  phone: string;
  vehicleInfo: {
    make: string;
    model: string;
    year: string;
  } | null;
}

export function formatUserContext(user: UserContext): string {
  const lines = [
    `## Current Customer`,
    `- Name: ${user.name}`,
    `- Email: ${user.email}`,
    `- Phone: ${user.phone}`,
  ];

  if (user.vehicleInfo) {
    lines.push(
      `- Vehicle: ${user.vehicleInfo.year} ${user.vehicleInfo.make} ${user.vehicleInfo.model}`,
    );
  } else {
    lines.push(`- Vehicle: Not specified`);
  }

  lines.push(`- Customer ID: ${user.id}`);

  return lines.join("\n");
}
```

**Step 2: Commit**

```bash
git add apps/api/src/types/user-context.ts
git commit -m "feat(api): add UserContext type and formatter"
```

---

## Task 6: Update agent to accept user context

**Files:**

- Modify: `apps/api/src/agent.ts`

**Step 1: Update createHmlsAgent to accept user context**

```typescript
import { anthropic, createZypherAgent } from "@corespeed/zypher";
import { env } from "./env.ts";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { schedulingTools } from "./tools/scheduling.ts";
import { serviceTools } from "./tools/customer.ts";
import { stripeTools } from "./tools/stripe.ts";
import { estimateTools } from "./skills/estimate/tools.ts";
import { formatUserContext, type UserContext } from "./types/user-context.ts";

// Default model, can be overridden via env
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export interface CreateAgentOptions {
  userContext?: UserContext;
}

export async function createHmlsAgent(options: CreateAgentOptions = {}) {
  const modelId = env.AGENT_MODEL || DEFAULT_MODEL;
  console.log(`[agent] Creating HMLS agent with model: ${modelId}`);

  // Build system prompt with user context if available
  const systemPrompt = options.userContext
    ? `${SYSTEM_PROMPT}\n\n${formatUserContext(options.userContext)}`
    : SYSTEM_PROMPT;

  const agent = await createZypherAgent({
    model: anthropic(modelId, { apiKey: env.ANTHROPIC_API_KEY }),
    tools: [...serviceTools, ...estimateTools, ...stripeTools, ...schedulingTools],
    overrides: {
      systemPromptLoader: async () => systemPrompt,
    },
  });

  // Discover and log skills
  await agent.skills.discover();
  const skillNames = Array.from(agent.skills.skills.values()).map(
    (s) => s.metadata.name,
  );
  if (skillNames.length > 0) {
    console.log(`[agent] Skills loaded: ${skillNames.join(", ")}`);
  }

  return agent;
}
```

**Step 2: Run typecheck**

Run: `cd /home/spenc/hmls && turbo typecheck --filter=@hmls/api` Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/agent.ts
git commit -m "feat(api): add user context injection to agent"
```

---

## Task 7: Update index.ts to pass user context

**Files:**

- Modify: `apps/api/src/index.ts`

**Step 1: Update the /task endpoint to extract and pass user context**

The user context will come from a header (set by the web frontend after authentication). Update the
agent creation to be per-request instead of singleton when user context is present.

```typescript
// Near the top, add import
import { type UserContext } from "./types/user-context.ts";

// Replace the agent singleton section with:
// Agent cache by user ID (or singleton for anonymous)
const agentCache = new Map<
  string,
  Awaited<ReturnType<typeof createHmlsAgent>>
>();

async function getAgent(userContext?: UserContext) {
  const cacheKey = userContext ? `user:${userContext.id}` : "anonymous";

  if (!agentCache.has(cacheKey)) {
    const agent = await createHmlsAgent({ userContext });
    agentCache.set(cacheKey, agent);
  }

  return agentCache.get(cacheKey)!;
}

// Update the /task endpoint to extract user context from header
app.post("/task", async (c) => {
  const body = await c.req.json();

  let input;
  try {
    input = parseRunAgentInput(body);
  } catch (parseError) {
    throw Errors.validation("Invalid AG-UI input", String(parseError));
  }

  // Extract user context from header (set by web frontend)
  let userContext: UserContext | undefined;
  const userContextHeader = c.req.header("X-User-Context");
  if (userContextHeader) {
    try {
      userContext = JSON.parse(userContextHeader);
    } catch {
      console.warn("[agent] Invalid X-User-Context header");
    }
  }

  const { threadId, runId, messages } = input;
  console.log(
    `[agent] threadId=${threadId}, messages=${messages.length}, user=${
      userContext?.id ?? "anonymous"
    }`,
  );

  const agent = await getAgent(userContext);
  const aguiStream = createAguiEventStream({
    agent,
    messages,
    threadId,
    runId,
  });

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of eachValueFrom(aguiStream)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error) {
      console.error(`[agent] Stream error:`, error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "RUN_ERROR",
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});
```

**Step 2: Run typecheck**

Run: `cd /home/spenc/hmls && turbo typecheck --filter=@hmls/api` Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): pass user context from header to agent"
```

---

## Task 8: Run dev server and verify

**Step 1: Start the dev server**

Run: `cd /home/spenc/hmls/apps/api && deno task dev` Expected: Server starts without errors

**Step 2: Test health endpoint**

Run: `curl http://localhost:8080/health` Expected: `{"status":"ok","timestamp":"..."}`

**Step 3: Commit all changes**

```bash
git add -A
git commit -m "feat(api): complete Mobile Mechanic Agent redesign

- Remove customer CRUD tools (user info from session)
- Remove invoice tool (owner handles post-service)
- Rewrite system prompt for receptionist role
- Add user context injection from X-User-Context header
- Keep: get_services, estimates, quotes, scheduling"
```

---

## Summary

After completing all tasks, the agent will:

1. Only expose 6 tools: `get_services`, `create_estimate`, `get_estimate`, `create_quote`,
   `get_quote_status`, `get_availability`, `create_booking`
2. Receive logged-in user context via `X-User-Context` header
3. Have a simplified receptionist-focused system prompt
4. No longer handle customer creation or invoicing
