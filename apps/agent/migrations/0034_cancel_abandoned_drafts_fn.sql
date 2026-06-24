-- Auto-cancel abandoned drafts — function only, no pg_cron.
--
-- 0017 wrapped this function together with `CREATE EXTENSION pg_cron` and a
-- `cron.schedule(...)` call inside one transaction. pg_cron is NOT installed on
-- our Supabase instance, so the CREATE EXTENSION failed and the whole
-- transaction rolled back: the function was never created and abandoned drafts
-- were never reaped.
--
-- This migration recreates the function standalone (idempotent, no extension
-- dependency), so it applies cleanly with or without pg_cron. The daily
-- schedule now lives in the gateway as a Deno.cron job
-- (apps/gateway/src/index.ts), which runs on Deno Deploy and calls
-- `SELECT cancel_abandoned_drafts(14)` — no pg_cron required.
--
-- Logic is identical to 0017: flip drafts untouched for `stale_days` days with
-- no `scheduled_at` into `cancelled`, appending a status_history entry and an
-- order_events row that mirror what the TS harness writes. Returns the count.

CREATE OR REPLACE FUNCTION cancel_abandoned_drafts(stale_days INTEGER DEFAULT 14)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  cancelled_count INTEGER;
  cutoff TIMESTAMPTZ := now() - make_interval(days => stale_days);
  reason TEXT := format('abandoned (no activity for %s days)', stale_days);
  now_ts TIMESTAMPTZ := now();
  -- Match the JS `Date.toISOString()` shape the app writes into status_history
  -- everywhere else, so the audit log stays uniform.
  now_iso TEXT := to_char(now_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  WITH updated AS (
    UPDATE orders
    SET status = 'cancelled',
        cancellation_reason = reason,
        status_history = status_history || jsonb_build_array(
          jsonb_build_object(
            'status', 'cancelled',
            'timestamp', now_iso,
            'actor', 'system:abandoned-cleanup'
          )
        ),
        updated_at = now_ts
    WHERE status = 'draft'
      AND scheduled_at IS NULL
      AND updated_at < cutoff
    RETURNING id
  )
  INSERT INTO order_events (order_id, event_type, from_status, to_status, actor, metadata)
  SELECT id, 'status_change', 'draft', 'cancelled', 'system:abandoned-cleanup',
         jsonb_build_object('reason', reason, 'stale_days', stale_days)
  FROM updated;

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;
  RETURN cancelled_count;
END;
$$;
