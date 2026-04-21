-- Simplify the orders status machine and add manual-payment fields.
--
-- Before: draft → estimated → approved → preauth → scheduled → in_progress → invoiced → paid → completed → archived
-- After:  draft → estimated → approved → scheduled → in_progress → completed
--                    ↓           ↓                                  ↓
--                 declined  cancelled                           cancelled
--                    ↓
--                 revised → estimated
--
-- Removed states: preauth, invoiced, paid, archived, void.
-- Payment is now a property of a completed order (paid_at + payment_method),
-- not a separate status.

BEGIN;

-- 1. Add payment columns (manual payment tracking)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_method varchar(30),
  ADD COLUMN IF NOT EXISTS payment_reference varchar(255);

-- 2. Remap existing statuses
-- preauth → approved (card was on file, but we don't track that state anymore)
UPDATE orders SET status = 'approved'
  WHERE status = 'preauth';

-- invoiced → in_progress (work was ongoing; invoiced was a bureaucratic sub-step)
UPDATE orders SET status = 'in_progress'
  WHERE status = 'invoiced';

-- paid → completed + paid_at stamp
UPDATE orders
  SET status = 'completed',
      paid_at = COALESCE(paid_at, updated_at)
  WHERE status = 'paid';

-- archived → completed (archived was just a UI filter, not a lifecycle state)
UPDATE orders SET status = 'completed'
  WHERE status = 'archived';

-- void → cancelled (functional equivalent)
UPDATE orders SET status = 'cancelled'
  WHERE status = 'void';

-- Orphan "sent" status (historical drift) → estimated
UPDATE orders SET status = 'estimated'
  WHERE status = 'sent';

COMMIT;
