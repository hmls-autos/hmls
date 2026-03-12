# Supabase Consolidation Design

## Summary

Consolidate from Neon + Supabase (two databases) to Supabase-only (one database). Move all business
tables into Supabase's Postgres so auth and data live together. Replace the app-level customer sync
with a DB trigger.

## Decisions

- **Start fresh** — no data to migrate from Neon, re-seed in Supabase
- **Direct Postgres connection** — Deno API connects via Supabase's direct connection string with
  Drizzle ORM
- **DB trigger** for auth-customer sync — replaces the /auth/sync API endpoint
- **Remove Neon** — no more local Postgres or Neon dependency

## Current State

- Neon Postgres: all business tables (customers, services, bookings, quotes, estimates, etc.)
- Supabase Postgres: auth only (auth.users, sessions)
- Deno API: Drizzle ORM → Neon via DATABASE_URL
- App-level /auth/sync endpoint for customer matching (built in social login feature)

## Target State

- Supabase Postgres: auth + all business tables in public schema
- Deno API: Drizzle ORM → Supabase via DATABASE_URL (same ORM code, different connection string)
- DB trigger on auth.users INSERT → auto match/create customer
- No Neon, no /auth/sync endpoint

## Changes Required

### Supabase Migrations (SQL)

1. Create all tables: services, customers (with auth_user_id), conversations, messages, bookings,
   quotes, pricingConfig, vehiclePricing, estimates, invoices
2. Seed data: services, pricing_config, vehicle_pricing
3. Create trigger function `handle_new_user()` + trigger on auth.users

### Code Changes

- Remove: `apps/api/src/routes/auth.ts` (the /auth/sync endpoint)
- Modify: `apps/api/src/index.ts` (unmount auth route)
- Modify: `apps/web/app/auth/callback/route.ts` (remove sync fetch call)
- Modify: CLAUDE.md, .env examples (update DATABASE_URL references)
- Remove: `deno task db:up` and Neon-related tasks from deno.json

### Environment

- Update `DATABASE_URL` to Supabase's direct Postgres connection string
- Works for both local dev and production (same Supabase project)

## Migration Order

1. Create tables in Supabase
2. Seed data
3. Add DB trigger for auth-customer sync
4. Update DATABASE_URL in env
5. Remove /auth/sync endpoint + simplify callback
6. Clean up Neon references
7. Verify everything works
