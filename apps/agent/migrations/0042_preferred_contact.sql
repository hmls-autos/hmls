-- 0042: customer preferred contact method + manual-outreach event type
--
-- Adds the "permission" layer for manual follow-up: the customer picks how
-- the shop should reach them (text / call / email) in chat; admins see it on
-- the order and log outreach. Automated notifications stay email regardless.
--
-- Idempotent. Apply via scripts/db-apply.sh (staging first, then prod).
--
-- ⚠️ Do NOT use the 'customer_contacted' enum value in this file (e.g. seed
-- rows): db-apply.sh runs psql --single-transaction, and Postgres forbids
-- using a new enum value inside the transaction that added it.

DO $$
BEGIN
  CREATE TYPE contact_method AS ENUM ('text', 'call', 'email');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_contact contact_method;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_preferred contact_method;

ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'customer_contacted';

-- Migration 0041 revoked table-level UPDATE on orders/customers from
-- tenant_app and re-granted column-by-column, so every new column needs its
-- own grant or prod writes fail with "permission denied" (0041's own
-- contract). Role-guarded: tenant_app only exists in staging/prod.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_app') THEN
    GRANT UPDATE (preferred_contact) ON customers TO tenant_app;
    GRANT UPDATE (contact_preferred) ON orders TO tenant_app;
  END IF;
END $$;
