-- 0036: seed per-shop service radius (km) so order routing can flag
-- out-of-coverage service addresses (nearestShop already enforces the cap;
-- the column was created NULL in 0030 and never seeded).
-- TUNABLE KNOB: widen/narrow per metro as real coverage data accrues. 80km is
-- a deliberately loose metro radius (errs toward NOT flagging legit edge
-- customers). Only seeds rows that are still NULL, so re-running is a no-op and
-- a hand-tuned value is never overwritten.
UPDATE shops SET service_radius_km = 80
WHERE slug IN ('san-jose', 'orange-county') AND service_radius_km IS NULL;
