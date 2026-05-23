-- Add `estimate_snapshot` jsonb column to fixo_reports so the diagnostic PDF
-- can render priced, tier-grouped line items (required / recommended /
-- maintenance / optional) alongside the qualitative issues section.
--
-- Snapshotted at session-completion time from the most recent fixo_estimates
-- row for the session, frozen for historical reproducibility (same pattern
-- as vehicle_snapshot and media_snapshot). NULL when the session never
-- produced an estimate.
--
-- Shape mirrors fixo_estimates select-row (id, items, subtotalCents,
-- priceRangeLowCents, priceRangeHighCents, vehicleInfo, validDays, expiresAt,
-- shareToken, notes, createdAt). Validated at render time, not at the DB
-- boundary (jsonb).
--
-- Existing rows stay NULL — historic reports render without the estimate
-- section.

BEGIN;

ALTER TABLE public.fixo_reports
  ADD COLUMN estimate_snapshot jsonb;

COMMIT;
