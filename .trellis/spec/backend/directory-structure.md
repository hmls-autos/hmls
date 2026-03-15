# Directory Structure

> How backend code is organized in this project.

---

## Overview

Two Deno backend apps share the same organizational pattern. A shared package provides
schema-agnostic utilities. All backend apps deploy to Deno Deploy.

---

## Directory Layout

```
apps/
├── api/src/                    # Main AI agent API
│   ├── index.ts                # Hono app setup, middleware, route mounting, Deno.serve
│   ├── agent.ts                # Zypher AI agent creation and configuration
│   ├── system-prompt.ts        # LLM system prompt as exported const string
│   ├── routes/                 # Hono sub-routers, one file per domain
│   │   ├── estimates.ts        # GET estimate, GET estimate PDF
│   │   ├── customers.ts        # GET customer
│   │   └── chat.ts             # AG-UI streaming endpoint + agent cache
│   ├── tools/                  # Zod-validated AI tool definitions
│   │   ├── customer.ts         # Customer CRUD tools
│   │   ├── stripe.ts           # Payment/invoice tools (factory function)
│   │   └── ask-user-question.ts
│   ├── skills/                 # Multi-tool workflows
│   │   └── estimate/           # Each skill is a directory
│   │       ├── index.ts
│   │       ├── tools.ts
│   │       ├── types.ts
│   │       ├── prompt.ts
│   │       └── pricing.ts
│   ├── db/
│   │   ├── schema.ts           # Drizzle ORM table definitions
│   │   ├── client.ts           # Re-exports shared createDbClient with local schema
│   │   ├── seed.ts             # Seed script
│   │   ├── migrate.ts          # Raw SQL migration
│   │   └── seed-data/          # JSON fixtures
│   ├── middleware/              # Auth middleware
│   ├── lib/                    # External service wrappers (Supabase, Stripe)
│   ├── pdf/                    # React-PDF templates (.tsx)
│   └── types/                  # Shared TypeScript interfaces
│
├── agent/src/fixo/             # Fixo AI agent
│   ├── main.ts                 # Hono app setup (same pattern as index.ts)
│   ├── agent.ts
│   ├── system-prompt.ts
│   ├── routes/                 # sessions.ts, input.ts, reports.ts, chat.ts, vehicles.ts, billing.ts
│   ├── tools/                  # analyzeImage.ts, lookupObdCode.ts, etc.
│   ├── db/                     # schema.ts, client.ts
│   ├── middleware/              # auth.ts, credits.ts, tier.ts
│   ├── lib/                    # supabase.ts, stripe.ts, r2.ts
│   └── test/                   # integration.test.ts
│
packages/
└── shared/src/                 # @hmls/shared — schema-agnostic utilities
    ├── lib/errors.ts           # AppError class, ErrorCode enum, Errors factories
    ├── lib/tool-result.ts      # MCP-compliant tool result helper
    └── db/client.ts            # createDbClient(schema) factory with lazy-init Proxy
```

---

## Module Organization

### Route Files

Each route file exports a named Hono sub-router, mounted at a prefix in the entrypoint:

```typescript
// apps/api/src/index.ts
app.route("/api/estimates", estimates);
app.route("/api/customers", customers);
app.route("/task", chat);
```

### Tool Files

Each tool file exports individual tool objects and a collected array:

```typescript
// Export individual tools + collected array
export const askUserQuestionTools = [askUserQuestionTool];

// Or use a factory function for tools needing config
export function createStripeTools() { return [...]; }
```

### Skill Directories

A skill is a directory under `skills/` with these files: `index.ts`, `tools.ts`, `types.ts`,
`prompt.ts`, and optionally domain-specific files like `pricing.ts`.

---

## Naming Conventions

| Item             | Convention                           | Example                        |
| ---------------- | ------------------------------------ | ------------------------------ |
| Files            | `camelCase.ts`                       | `askUserQuestion.ts`           |
| Route files      | Domain noun, lowercase               | `estimates.ts`, `customers.ts` |
| Tool files       | Domain noun, lowercase               | `stripe.ts`, `scheduling.ts`   |
| Entrypoint       | `index.ts` (API) or `main.ts` (fixo) | —                              |
| Middleware files | Feature name, lowercase              | `auth.ts`, `credits.ts`        |

---

## Examples

- **Well-organized route file**: `apps/api/src/routes/estimates.ts`
- **Tool with factory pattern**: `apps/api/src/tools/stripe.ts`
- **Skill directory**: `apps/api/src/skills/estimate/`
- **Shared package exports**: `packages/shared/deno.json` (sub-path exports)
