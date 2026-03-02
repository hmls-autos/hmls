# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Build & Development Commands

```bash
# Dev servers
cd apps/web && bun run dev       # Next.js on port 3000
deno task dev:api                # API agent on port 8080
deno task dev:diagnostic         # Diagnostic agent

# Build & quality
cd apps/web && bun run build     # Build Next.js
cd apps/web && bun run lint      # Lint with Biome
cd apps/web && bun run typecheck # TypeScript type checking
deno task check                  # Deno check both apps
deno task lint                   # Deno lint (excludes web)
deno task fmt:check              # Deno format check (excludes web)

# Database (Supabase PostgreSQL — no local DB needed)
deno task --cwd apps/api db:push      # Push schema changes to DB (dev)
deno task --cwd apps/api db:generate  # Generate migration files
deno task --cwd apps/api db:migrate   # Apply migrations (production)
deno task --cwd apps/api db:studio    # Drizzle Studio GUI
deno task --cwd apps/api db:seed      # Seed data
```

## Setup

```bash
cd apps/web && bun install       # Install web dependencies
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
├── web/                # Next.js 16 frontend (React 19, Tailwind CSS 4) → Deno Deploy
├── api/                # Deno AI agent (Zypher framework, Gemini 2.5 Flash, AG-UI protocol) → Deno Deploy
└── diagnostic-agent/   # Deno diagnostic agent → Deno Deploy
packages/
└── shared/             # @hmls/shared — shared utilities (errors, toolResult, db client)
```

### Service Communication

- **Web → Agent**: Direct AG-UI protocol connection via `@ag-ui/client` (port 8080)
- **Agent → DB**: Direct Supabase PostgreSQL connection via Drizzle ORM

### Key Patterns

**Shared Package** (`packages/shared/`): `@hmls/shared` with sub-path exports

- `@hmls/shared/errors` - AppError class, ErrorCode enum, Errors factories
- `@hmls/shared/tool-result` - MCP-compliant tool result helper
- `@hmls/shared/db` - Schema-agnostic `createDbClient(schema)` factory

**API Routes** (`apps/api/src/routes/`): Hono sub-routers mounted by `index.ts`

- `estimates.ts` - GET estimate, GET estimate PDF
- `customers.ts` - GET customer
- `chat.ts` - AG-UI streaming endpoint + agent cache

**Agent Tools** (`apps/api/src/tools/`): Zod-validated functions the AI can call

- `customer.ts` - Customer CRUD
- `stripe.ts` - Payments/invoices

**Agent Skills** (`apps/api/src/skills/`): Multi-tool workflows

- `estimate` - Calculate prices, generate PDFs

**Diagnostic Routes** (`apps/diagnostic-agent/src/routes/`): Hono sub-routers mounted by `main.ts`

- `sessions.ts` - CRUD for diagnostic sessions
- `input.ts` - Process diagnostic input (text, OBD, media)
- `chat.ts` - AG-UI streaming endpoint

**Database Schema** (`apps/api/src/db/schema.ts`): Drizzle ORM

- customers, conversations, messages, bookings, quotes, estimates
- `pricingConfig` / `vehiclePricing` tables for dynamic pricing
- `olpVehicles` / `olpLaborTimes` tables for OLP labor data

**Seed Data** (`apps/api/src/db/seed-data/`): JSON files imported by `seed.ts`

- `pricing-config.json`, `vehicle-pricing.json`, `providers.json`

**PDF Generation** (`apps/api/src/pdf/`): React-PDF templates served by API routes

## Pre-Push CI

**Always run the full CI suite locally before pushing:**

```bash
cd apps/web && bun run lint        # Biome lint
cd apps/web && bun run typecheck   # TypeScript check
cd apps/web && bun run build       # Next.js build
deno task check:api                # Deno check API
deno task check:diagnostic         # Deno check diagnostic agent
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
cd apps/web && bunx npm-check-updates -u && bun install
```

## Environment Variables

Required in `.env`:

```
DATABASE_URL=postgres://postgres.[ref]:[password]@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
GOOGLE_API_KEY=...              # Google AI Studio key for Gemini 2.5 Flash
STRIPE_SECRET_KEY=sk_test_...
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

| App | Domain | Hosting |
|-----|--------|---------|
| Web (HMLS) | `https://hmls.autos` | Deno Deploy |
| API Agent | — | Deno Deploy |
| Diagnostic Web | `https://diag.hmls.autos` | Vercel (`prj_EzagTZlxfjG6U6h3Cbdt8uWjPwdO`, scope: `spinsirrs-projects`) |
| Diagnostic Agent | `https://api.diag.hmls.autos` | Deno Deploy |

### Cloudflare DNS (zone: `hmls.autos`)

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `diag` | `cname.vercel-dns.com` | DNS only (gray cloud) |
| CNAME | `api.diag` | `<deno-deploy-project>.deno.dev` | DNS only (gray cloud) |

### Supabase Auth (project: `ddkapmjkubklyzuciscd`)

**URL Configuration** (Dashboard > Authentication > URL Configuration):
- **Site URL**: `https://hmls.autos`
- **Redirect URLs**:
  - `https://hmls.autos`
  - `http://localhost:3000`
  - `https://diag.hmls.autos/**`
  - `http://localhost:3001/**` (diagnostic local dev)

### Vercel Environment Variables (diagnostic-web)

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL --scope spinsirrs-projects
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY --scope spinsirrs-projects
vercel env add NEXT_PUBLIC_AGENT_URL --scope spinsirrs-projects  # https://api.diag.hmls.autos
```
