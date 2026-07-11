-- 0043: order_events indexes + schedule_ready_notified event type
--
-- Prep for the 9→7 status collapse (0044). TWO independent pieces:
--   1. order_events(order_id, created_at) index — the event feed is always
--      read as "this order's events, newest first" (TODOS.md debt; 0044
--      inserts one event per remapped row, so land the index first).
--   2. 'schedule_ready_notified' event type + a partial UNIQUE index making
--      it once-per-order. Writers insert with ON CONFLICT DO NOTHING: the
--      winner sends the customer's "appointment confirmed" email, losers
--      skip — dedups concurrent slot/mechanic pair completions (Codex C6).
--
-- Apply BEFORE 0044 and BEFORE deploying the PR-2 code (the code inserts
-- the new enum value). Idempotent — safe to rerun.
--
-- ⚠️ db-apply.sh runs psql --single-transaction. ALTER TYPE ... ADD VALUE is
-- allowed inside a transaction (PG 12+) but the NEW value cannot be USED in
-- the same transaction — and enum→text casts are not IMMUTABLE, so the
-- partial UNIQUE index can't live here either. It lives at the top of 0044
-- (separate transaction, so the enum literal is usable there).

ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'schedule_ready_notified';

CREATE INDEX IF NOT EXISTS order_events_order_id_created_at_idx
  ON order_events (order_id, created_at);
