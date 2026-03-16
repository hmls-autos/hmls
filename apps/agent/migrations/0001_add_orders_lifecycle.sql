-- Migration: Add orders table and order_events for unified order lifecycle
-- Date: 2026-03-15

-- 1. Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  estimate_id INTEGER REFERENCES estimates(id) ON DELETE SET NULL,
  quote_id INTEGER REFERENCES quotes(id),
  booking_id INTEGER REFERENCES bookings(id),
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  price_range_low_cents INTEGER,
  price_range_high_cents INTEGER,
  vehicle_info JSONB,
  valid_days INTEGER DEFAULT 30,
  expires_at TIMESTAMPTZ,
  share_token VARCHAR(64),
  revision_number INTEGER NOT NULL DEFAULT 1,
  stripe_quote_id VARCHAR(255),
  stripe_invoice_id VARCHAR(255),
  admin_notes TEXT,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create indexes on orders
CREATE INDEX IF NOT EXISTS orders_estimate_id_idx ON orders(estimate_id);
CREATE INDEX IF NOT EXISTS orders_share_token_idx ON orders(share_token);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders(customer_id);

-- 3. Create order_events audit log table
CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  from_status VARCHAR(50),
  to_status VARCHAR(50),
  actor VARCHAR(100),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Backfill existing estimates into orders
-- Convert legacy item format {name, description, price} → {service, description, unitPriceCents, totalCents, quantity, category}
INSERT INTO orders (
  customer_id, estimate_id, status, items, notes,
  subtotal_cents, price_range_low_cents, price_range_high_cents,
  vehicle_info, valid_days, expires_at, share_token,
  status_history, created_at, updated_at
)
SELECT
  e.customer_id,
  e.id,
  CASE
    WHEN e.share_token IS NOT NULL AND e.converted_to_quote_id IS NOT NULL THEN 'approved'
    WHEN e.share_token IS NOT NULL THEN 'sent'
    ELSE 'draft'
  END,
  -- Convert items format
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'service', COALESCE(item->>'name', item->>'service', 'Unknown'),
        'description', COALESCE(item->>'description', ''),
        'unitPriceCents', COALESCE((item->>'price')::int, (item->>'unitPriceCents')::int, 0),
        'totalCents', COALESCE((item->>'price')::int, (item->>'totalCents')::int, 0),
        'quantity', COALESCE((item->>'quantity')::int, 1),
        'category', COALESCE(item->>'category', 'labor')
      )
    ) FROM jsonb_array_elements(e.items) AS item),
    '[]'::jsonb
  ),
  e.notes,
  e.subtotal,
  e.price_range_low,
  e.price_range_high,
  e.vehicle_info,
  e.valid_days,
  e.expires_at,
  e.share_token,
  '[]'::jsonb,
  e.created_at,
  e.created_at
FROM estimates e
WHERE NOT EXISTS (
  SELECT 1 FROM orders o WHERE o.estimate_id = e.id
);

-- 5. Create order_events for backfilled orders
INSERT INTO order_events (order_id, event_type, to_status, actor, metadata)
SELECT o.id, 'status_change', o.status, 'migration', '{"note": "backfilled from estimates"}'::jsonb
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM order_events oe WHERE oe.order_id = o.id
);
