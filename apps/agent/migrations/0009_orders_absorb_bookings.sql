-- Layer 3 PR A: orders absorbs scheduling fields from bookings.
--
-- After this migration:
--   * orders has scheduled_at / duration_minutes / provider_id / location /
--     symptom_description / photo_urls / customer_notes / blocked_range fields.
--   * compute_blocked_range trigger fires on orders (and still on bookings —
--     bookings will be dropped in 0010 once all code is moved).
--   * Existing orders with booking_id get their booking's scheduling fields
--     copied in.

BEGIN;

-- 1. Add scheduling + service detail columns to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS appointment_end timestamptz,
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS provider_id integer REFERENCES providers(id),
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS location_lat numeric(10, 7),
  ADD COLUMN IF NOT EXISTS location_lng numeric(10, 7),
  ADD COLUMN IF NOT EXISTS access_instructions text,
  ADD COLUMN IF NOT EXISTS symptom_description text,
  ADD COLUMN IF NOT EXISTS photo_urls jsonb,
  ADD COLUMN IF NOT EXISTS customer_notes text,
  ADD COLUMN IF NOT EXISTS blocked_range tstzrange;

-- 2. Backfill from linked bookings.
UPDATE orders o
SET
  scheduled_at = b.scheduled_at,
  appointment_end = b.appointment_end,
  duration_minutes = b.duration_minutes,
  provider_id = b.provider_id,
  location = b.location,
  location_lat = b.location_lat,
  location_lng = b.location_lng,
  access_instructions = b.access_instructions,
  symptom_description = b.symptom_description,
  photo_urls = b.photo_urls,
  customer_notes = b.customer_notes,
  blocked_range = b.blocked_range
FROM bookings b
WHERE o.booking_id = b.id;

-- 3. Install the compute_blocked_range trigger on orders.
--    Same logic as the bookings version; fires on INSERT/UPDATE.
DROP TRIGGER IF EXISTS trg_orders_compute_blocked_range ON orders;
CREATE TRIGGER trg_orders_compute_blocked_range
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION compute_blocked_range();

-- 4. Indices for scheduling queries
CREATE INDEX IF NOT EXISTS orders_scheduled_at_idx
  ON orders (scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_provider_id_idx
  ON orders (provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_blocked_range_gist
  ON orders USING GIST (blocked_range) WHERE blocked_range IS NOT NULL;

COMMIT;
