# Prompt Builder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Create a modular, type-safe system prompt builder for HMLS agents that supports both
Mobile Mechanic Agent and future AI Diagnostic Agent.

**Architecture:** Section-based prompt builder where each section is a function that returns
string[]. Sections can be shared or customized per agent type.

**Tech Stack:** TypeScript, Deno

---

## Task 1: Create types.ts

**Files:**

- Create: `apps/api/src/prompts/types.ts`

**Content:**

```typescript
// apps/api/src/prompts/types.ts

export type AgentType = "receptionist" | "diagnostic";

export interface UserContext {
  id: number;
  name: string;
  email: string;
  phone: string;
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface PromptConfig {
  agentType: AgentType;
  userContext?: UserContext;
  tools?: ToolInfo[];
  locale?: string; // e.g., "en", "zh", "es"
}

export type PromptSection = (config: PromptConfig) => string[];
```

**Commit:** `feat(api): add prompt builder types`

---

## Task 2: Create identity section

**Files:**

- Create: `apps/api/src/prompts/sections/identity.ts`

**Content:**

```typescript
// apps/api/src/prompts/sections/identity.ts

import type { PromptConfig } from "../types.ts";

export function buildIdentitySection(_config: PromptConfig): string[] {
  return [
    "You are a helpful customer service assistant for HMLS Mobile Mechanic, a mobile automotive repair service in Orange County, California.",
    "",
  ];
}
```

**Commit:** `feat(api): add identity prompt section`

---

## Task 3: Create business section

**Files:**

- Create: `apps/api/src/prompts/sections/business.ts`

**Content:**

```typescript
// apps/api/src/prompts/sections/business.ts

import type { PromptConfig } from "../types.ts";

export function buildBusinessSection(_config: PromptConfig): string[] {
  return [
    "## About HMLS",
    "- Mobile mechanic service that comes to customers' locations",
    "- Over 20+ years of hands-on automotive experience",
    "- Service area: Orange County (Irvine, Newport Beach, Anaheim, Santa Ana, Costa Mesa, Fullerton, Huntington Beach, Lake Forest, Mission Viejo)",
    "",
    "## Business Hours",
    "Monday - Saturday: 8:00 AM - 12:00 AM (Midnight)",
    "",
  ];
}
```

**Commit:** `feat(api): add business prompt section`

---

## Task 4: Create role section

**Files:**

- Create: `apps/api/src/prompts/sections/role.ts`

**Content:**

```typescript
// apps/api/src/prompts/sections/role.ts

import type { PromptConfig } from "../types.ts";

export function buildRoleSection(config: PromptConfig): string[] {
  if (config.agentType === "receptionist") {
    return [
      "## Your Role",
      "You are a receptionist helping logged-in customers with:",
      "1. Answering questions about our services",
      "2. Providing price estimates for repairs",
      "3. Sending formal quotes when customers are ready",
      "4. Helping customers book appointments",
      "",
    ];
  }

  // diagnostic agent (future)
  return [
    "## Your Role",
    "You are an automotive diagnostic specialist helping customers understand their vehicle issues:",
    "1. Ask questions to understand symptoms",
    "2. Analyze possible causes",
    "3. Recommend services based on diagnosis",
    "4. Provide estimates for recommended repairs",
    "",
  ];
}
```

**Commit:** `feat(api): add role prompt section`

---

## Task 5: Create user context section

**Files:**

- Create: `apps/api/src/prompts/sections/user-context.ts`

**Content:**

```typescript
// apps/api/src/prompts/sections/user-context.ts

import type { PromptConfig } from "../types.ts";

export function buildUserContextSection(config: PromptConfig): string[] {
  const lines = [
    "## Customer Context",
    "The customer is already logged in. Their basic information (name, phone, email) is available in the conversation context.",
    "",
    "**Important:** Vehicle information is NOT stored in the profile. You must ask the customer about their vehicle (make, model, year) when they need an estimate or booking.",
    "",
  ];

  if (config.userContext) {
    const { name, email, phone, id } = config.userContext;
    lines.push(
      "## Current Customer",
      `- Name: ${name}`,
      `- Email: ${email}`,
      `- Phone: ${phone}`,
      `- Customer ID: ${id}`,
      "",
    );
  }

  return lines;
}
```

**Commit:** `feat(api): add user context prompt section`

---

## Task 6: Create workflow section

**Files:**

- Create: `apps/api/src/prompts/sections/workflow.ts`

**Content:**

```typescript
// apps/api/src/prompts/sections/workflow.ts

import type { PromptConfig } from "../types.ts";

export function buildWorkflowSection(config: PromptConfig): string[] {
  if (config.agentType === "receptionist") {
    return [
      "## Workflow",
      "",
      "### Service Inquiries",
      "- Use get_services to look up available services and pricing",
      "- Explain what each service includes",
      "- Answer questions about what we can and cannot do",
      "",
      "### Estimates & Quotes",
      "1. Ask the customer about their vehicle (make, model, year) if not already provided",
      "2. Customer describes what they need → Use create_estimate to generate a PDF estimate",
      "3. If customer is satisfied → Use create_quote to send a formal Stripe quote via email",
      "4. Customer can check quote status using get_quote_status",
      "",
      "### Booking Appointments",
      "1. Use get_availability to check available time slots",
      "2. Use create_booking to schedule the appointment",
      "3. Confirm the date, time, and location with the customer",
      "",
    ];
  }

  // diagnostic agent (future)
  return [
    "## Workflow",
    "",
    "### Diagnosis Process",
    "1. Ask about symptoms: What's happening? When did it start? Any sounds/smells?",
    "2. Ask about conditions: Does it happen at certain speeds? Hot or cold engine?",
    "3. Analyze possible causes based on symptoms",
    "4. Explain your diagnosis in simple terms",
    "5. Recommend services and provide estimate",
    "",
  ];
}
```

**Commit:** `feat(api): add workflow prompt section`

---

## Task 7: Create guidelines section

**Files:**

- Create: `apps/api/src/prompts/sections/guidelines.ts`

**Content:**

```typescript
// apps/api/src/prompts/sections/guidelines.ts

import type { PromptConfig } from "../types.ts";

export function buildGuidelinesSection(config: PromptConfig): string[] {
  const baseGuidelines = [
    "## Guidelines",
    "- Respond in the customer's language (English, Chinese, Spanish, etc.)",
    "- Be friendly, professional, and helpful",
    "- Always ask for vehicle info (make, model, year) before giving estimates",
    "- If a request is outside our service area or capabilities, politely explain",
  ];

  if (config.agentType === "receptionist") {
    baseGuidelines.push("- Always confirm appointment details before booking");
  }

  if (config.agentType === "diagnostic") {
    baseGuidelines.push(
      "- Use simple, non-technical language when explaining issues",
      "- Always explain WHY something might be happening, not just WHAT",
    );
  }

  baseGuidelines.push("");

  return baseGuidelines;
}
```

**Commit:** `feat(api): add guidelines prompt section`

---

## Task 8: Create pricing section

**Files:**

- Create: `apps/api/src/prompts/sections/pricing.ts`

**Content:**

```typescript
// apps/api/src/prompts/sections/pricing.ts

import type { PromptConfig } from "../types.ts";

export function buildPricingSection(_config: PromptConfig): string[] {
  return [
    "## Pricing Guidelines",
    "Base prices are in the services database. Adjust based on:",
    "- Vehicle type (luxury/European may cost more)",
    "- Issue complexity",
    "- Parts needed (OEM vs aftermarket)",
    "",
    "Always explain your reasoning when the price differs from the base range.",
    "",
  ];
}
```

**Commit:** `feat(api): add pricing prompt section`

---

## Task 9: Create builder.ts

**Files:**

- Create: `apps/api/src/prompts/builder.ts`

**Content:**

```typescript
// apps/api/src/prompts/builder.ts

import type { PromptConfig, PromptSection } from "./types.ts";
import { buildIdentitySection } from "./sections/identity.ts";
import { buildBusinessSection } from "./sections/business.ts";
import { buildRoleSection } from "./sections/role.ts";
import { buildUserContextSection } from "./sections/user-context.ts";
import { buildWorkflowSection } from "./sections/workflow.ts";
import { buildGuidelinesSection } from "./sections/guidelines.ts";
import { buildPricingSection } from "./sections/pricing.ts";

const DEFAULT_SECTIONS: PromptSection[] = [
  buildIdentitySection,
  buildBusinessSection,
  buildRoleSection,
  buildUserContextSection,
  buildWorkflowSection,
  buildPricingSection,
  buildGuidelinesSection,
];

export function buildSystemPrompt(
  config: PromptConfig,
  sections: PromptSection[] = DEFAULT_SECTIONS,
): string {
  const lines: string[] = [];

  for (const section of sections) {
    lines.push(...section(config));
  }

  return lines.join("\n");
}
```

**Commit:** `feat(api): add prompt builder`

---

## Task 10: Create index.ts and update agent.ts

**Files:**

- Create: `apps/api/src/prompts/index.ts`
- Modify: `apps/api/src/agent.ts`

**prompts/index.ts:**

```typescript
// apps/api/src/prompts/index.ts

export { buildSystemPrompt } from "./builder.ts";
export type { AgentType, PromptConfig, PromptSection, ToolInfo, UserContext } from "./types.ts";
```

**agent.ts changes:**

- Import `buildSystemPrompt` and `PromptConfig` from `./prompts/index.ts`
- Remove import of `SYSTEM_PROMPT` from `./system-prompt.ts`
- Update `createHmlsAgent` to use `buildSystemPrompt`

```typescript
import { anthropic, createZypherAgent } from "@corespeed/zypher";
import { env } from "./env.ts";
import { buildSystemPrompt, type PromptConfig, type UserContext } from "./prompts/index.ts";
import { schedulingTools } from "./tools/scheduling.ts";
import { serviceTools } from "./tools/customer.ts";
import { stripeTools } from "./tools/stripe.ts";
import { estimateTools } from "./skills/estimate/tools.ts";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export interface CreateAgentOptions {
  userContext?: UserContext;
}

export async function createHmlsAgent(options: CreateAgentOptions = {}) {
  const modelId = env.AGENT_MODEL || DEFAULT_MODEL;
  console.log(`[agent] Creating HMLS agent with model: ${modelId}`);

  const promptConfig: PromptConfig = {
    agentType: "receptionist",
    userContext: options.userContext,
  };

  const systemPrompt = buildSystemPrompt(promptConfig);

  const agent = await createZypherAgent({
    model: anthropic(modelId, { apiKey: env.ANTHROPIC_API_KEY }),
    tools: [...serviceTools, ...estimateTools, ...stripeTools, ...schedulingTools],
    overrides: {
      systemPromptLoader: async () => systemPrompt,
    },
  });

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

**Commit:** `feat(api): integrate prompt builder with agent`

---

## Task 11: Remove old system-prompt.ts and cleanup

**Files:**

- Delete: `apps/api/src/system-prompt.ts`
- Delete: `apps/api/src/types/user-context.ts` (moved to prompts/types.ts)

**Commit:** `refactor(api): remove old system-prompt.ts and user-context.ts`

---

## Task 12: Test and verify

**Steps:**

1. Run typecheck: `cd /home/spenc/hmls && turbo typecheck --filter=@hmls/api`
2. Start dev server: `deno task dev`
3. Test health endpoint: `curl http://localhost:8080/health`

**Commit:** Final verification, no commit needed

---

## Summary

After completing all tasks:

- Modular prompt builder in `apps/api/src/prompts/`
- 7 reusable sections (identity, business, role, user-context, workflow, pricing, guidelines)
- Type-safe configuration via `PromptConfig`
- Ready for AI Diagnostic Agent (just change `agentType: "diagnostic"`)
