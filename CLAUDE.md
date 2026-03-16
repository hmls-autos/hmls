# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Build & Development Commands

```bash
# Dev servers
cd apps/hmls-web && bun run dev       # Next.js on port 3000
deno task dev:api                # API + Fixo agent on port 8080
# Main API: http://localhost:8080
# Fixo API: http://fixo.localhost:8080

# Build & quality
cd apps/hmls-web && bun run build     # Build Next.js
cd apps/hmls-web && bun run lint      # Lint with Biome
cd apps/hmls-web && bun run typecheck # TypeScript type checking
deno task check                  # Deno check gateway + agent
deno task lint                   # Deno lint (excludes web)
deno task fmt:check              # Deno format check (excludes web)

# Database (Supabase PostgreSQL — no local DB needed)
deno task --cwd apps/agent db:push      # Push schema changes to DB (dev)
deno task --cwd apps/agent db:generate  # Generate migration files
deno task --cwd apps/agent db:migrate   # Apply migrations (production)
deno task --cwd apps/agent db:studio    # Drizzle Studio GUI
```

## Setup

```bash
cd apps/hmls-web && bun install       # Install web dependencies
git config core.hooksPath .githooks  # Enable pre-commit hook
# Set DATABASE_URL in .env.local to your Supabase connection string
```

## Architecture

Deno workspace monorepo for a mobile mechanic business with an AI-powered chat agent. All apps
deploy to **Deno Deploy** (console.deno.com) via GitHub integration. Root config is `deno.json`; web
app uses Bun/Next.js internally. Root `deno.json` `imports` are inherited by all workspace members —
shared deps go there, app-specific deps in each app's `deno.json`.

```
apps/
├── hmls-web/           # Next.js 16 frontend (React 19, Tailwind CSS 4) → Deno Deploy
├── gateway/            # HTTP server (Hono, routing, auth, CORS) → Deno Deploy
└── agent/              # AI agents + domain logic (library package)
    ├── llm/            #   GeminiOpenAIProvider (shared)
    ├── db/             #   Drizzle schema + client (shared)
    ├── hmls/           #   HMLS agent, tools, skills, PDF
    └── fixo/           #   Fixo agent, tools, lib, PDF
packages/
└── shared/             # @hmls/shared — shared utilities (errors, toolResult, db client)
```

### Service Communication & Subdomain Routing

The API server uses hostname-based dispatch to route requests:

- **`localhost:8080`** / default → Main HMLS API (estimates, portal, admin, chat)
- **`fixo.localhost:8080`** / `api.fixo.hmls.autos` → Fixo API (sessions, billing, vehicles, chat)

Each sub-app has its own CORS, auth middleware, and error handler. No middleware leaks between
domains.

- **Web → Agent**: AI SDK v6 `useChat` with `DefaultChatTransport` (port 8080)
- **Fixo Web → Agent**: AI SDK v6 via `http://fixo.localhost:8080` / `https://api.fixo.hmls.autos`
- **Agent → DB**: Direct Supabase PostgreSQL connection via Drizzle ORM

### Key Patterns

**Shared Package** (`packages/shared/`): `@hmls/shared` with sub-path exports

- `@hmls/shared/errors` - AppError class, ErrorCode enum, Errors factories
- `@hmls/shared/tool-result` - MCP-compliant tool result helper
- `@hmls/shared/db` - Schema-agnostic `createDbClient(schema)` factory

**Gateway Routes** (`apps/gateway/src/routes/`): Hono sub-routers mounted by `hmls-app.ts`

- `estimates.ts` - GET estimate, GET estimate PDF
- `chat.ts` - AG-UI streaming endpoint
- `orders.ts`, `admin.ts`, `portal.ts` - CRUD routes
- `webhook.ts` - Stripe webhook handler
- `fixo/` - Fixo sub-app routes (sessions, input, chat, billing, reports, vehicles)

**Gateway Middleware** (`apps/gateway/src/middleware/`): Auth + admin middleware

- `auth.ts` - HMLS: requireAuth, optionalAuth
- `admin.ts` - Admin role check
- `fixo/` - Fixo-specific auth, credits, tier

**Agent Package** (`apps/agent/`): `@hmls/agent` with sub-path exports

- `@hmls/agent` → Agent factories, types, fixo lib, notifications, PDF components
- `@hmls/agent/db` → Drizzle DB client + schema

**HMLS Agent** (`apps/agent/src/hmls/`): Zypher + Gemini 2.5 Flash

- `agent.ts` - createHmlsAgent() factory
- `tools/` - stripe, scheduling, labor-lookup, parts-lookup, ask-user-question
- `skills/estimate/` - Pricing, PDF generation
- `pdf/EstimatePdf.tsx` - React-PDF estimate template

**Fixo Agent** (`apps/agent/src/fixo/`): Zypher + Gemini 2.5 Flash

- `agent.ts` - createFixoAgent() factory
- `tools/` - Vision analysis, audio spectrogram, OBD lookup, storage
- `lib/` - Stripe credits, Supabase storage, agent cache
- `pdf/fixo-report.tsx` - React-PDF fixo report

**Database Schema** (`apps/agent/src/db/schema.ts`): Drizzle ORM

- customers, conversations, messages, bookings, quotes, estimates
- `pricingConfig` / `vehiclePricing` tables for dynamic pricing
- `olpVehicles` / `olpLaborTimes` tables for OLP labor data
- `userProfiles` / `vehicles` / `fixoSessions` / `fixoMedia` / `obdCodes` for fixo

## Pre-Push CI

**Always run the full CI suite locally before pushing:**

```bash
cd apps/hmls-web && bun run lint        # Biome lint
cd apps/hmls-web && bun run typecheck   # TypeScript check
cd apps/hmls-web && bun run build       # Next.js build
deno task check                    # Deno check gateway + agent
```

Do not push if any of these fail.

## Code Style

- **Web**: Biome (double quotes, 2-space indent)
- **Deno apps**: `deno fmt` (double quotes, 2-space indent, 100 char line width) + `deno lint`
- **TypeScript**: Strict mode across all packages
- **Commits**: Conventional format - `feat(scope): description`

## Updating Dependencies

```bash
# Deno apps — update versions in deno.json, then:
deno install

# Web app
cd apps/hmls-web && bunx npm-check-updates -u && bun install
```

## Environment Variables

Required in `.env`:

```
DATABASE_URL=postgres://postgres.[ref]:[password]@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
GOOGLE_API_KEY=...              # Google AI Studio key for Gemini 2.5 Flash
STRIPE_SECRET_KEY=sk_test_...
SUPABASE_URL=...                # Supabase project URL
SUPABASE_ANON_KEY=...           # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=...   # Supabase service role key (fixo media storage)
```

Optional in web (`.env.local`):

```
NEXT_PUBLIC_AGENT_URL=http://localhost:8080  # defaults to localhost:8080
```

## Deno Deploy CLI

Use `deno deploy` (NOT `deployctl` — deprecated):

```bash
# Environment variables
deno deploy env list --app hmls-api --org spinsirr
deno deploy env add <KEY> <VALUE> --app hmls-api --org spinsirr --secret
deno deploy env delete <KEY> --app hmls-api --org spinsirr
```

## Deployment & Domains

### Production URLs

| App               | Domain                               | Hosting                                                                  |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| Web (HMLS)        | `https://hmls.autos`                 | Deno Deploy                                                              |
| API (main + fixo) | `https://api.fixo.hmls.autos` (fixo) | Deno Deploy (`hmls-api`)                                                 |
| Fixo Web          | `https://fixo.hmls.autos`            | Vercel (`prj_EzagTZlxfjG6U6h3Cbdt8uWjPwdO`, scope: `spinsirrs-projects`) |

Both main API and Fixo API run in the same Deno Deploy app (`hmls-api`), routed by hostname.

### Cloudflare DNS (zone: `hmls.autos`)

| Type  | Name       | Target                 | Proxy                 |
| ----- | ---------- | ---------------------- | --------------------- |
| CNAME | `fixo`     | `cname.vercel-dns.com` | DNS only (gray cloud) |
| CNAME | `api.fixo` | `hmls-api.deno.dev`    | DNS only (gray cloud) |

### Supabase Auth (project: `ddkapmjkubklyzuciscd`)

**URL Configuration** (Dashboard > Authentication > URL Configuration):

- **Site URL**: `https://hmls.autos`
- **Redirect URLs**:
  - `https://hmls.autos`
  - `http://localhost:3000`
  - `https://fixo.hmls.autos/**`
  - `http://localhost:3001/**` (fixo local dev)

### Vercel Environment Variables (fixo-web)

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL --scope spinsirrs-projects
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY --scope spinsirrs-projects
vercel env add NEXT_PUBLIC_AGENT_URL --scope spinsirrs-projects  # https://api.fixo.hmls.autos
```
