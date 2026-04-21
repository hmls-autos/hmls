-- Layer 3 PR C: drop legacy tables and their FK columns on orders.
--
-- After this:
--   * `bookings`, `estimates`, `quotes` tables are gone.
--   * orders no longer has estimate_id / quote_id / booking_id /
--     stripe_quote_id / stripe_invoice_id / stripe_payment_intent_id /
--     preauth_amount_cents columns.
--   * Scheduling lives entirely on `orders`.

BEGIN;

-- 1. Drop orders columns that reference legacy tables
ALTER TABLE orders
  DROP COLUMN IF EXISTS estimate_id,
  DROP COLUMN IF EXISTS quote_id,
  DROP COLUMN IF EXISTS booking_id,
  DROP COLUMN IF EXISTS stripe_quote_id,
  DROP COLUMN IF EXISTS stripe_invoice_id,
  DROP COLUMN IF EXISTS stripe_payment_intent_id,
  DROP COLUMN IF EXISTS preauth_amount_cents;

-- 2. Drop legacy tables
DROP TABLE IF EXISTS quotes CASCADE;
DROP TABLE IF EXISTS estimates CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;

COMMIT;
