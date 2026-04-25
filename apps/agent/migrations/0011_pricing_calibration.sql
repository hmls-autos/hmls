-- Pricing calibration for the mobile-mechanic SaaS dogfood shop.
--
-- Original seed values produced ~$134 for a 2019 Camry full-synthetic oil change
-- (0.3h labor × $140/h = $42, parts $36 × 1.40 markup = $50.40, $15 hazmat,
-- minimum-fee floor inflation). Real-world mobile-mechanic competitive range
-- in this market is $90–$110 for a synthetic oil change, so we trimmed the
-- hazmat fee to better reflect actual fluid disposal cost (mobile rigs carry
-- their own waste containers — true cost is ~$5-10 per service, not $15).
--
-- After this:
--   * tier-1 markup stays at 40% (RockAuto returns wholesale-discount prices,
--     so 40% is needed to land at retail-mechanic territory).
--   * hazmat disposal drops to $8.
--   * Net effect on a 2019 Camry full-synthetic oil change: $99.62
--     (range ~$89.66–$109.58), mid-band of the target $90–$110.
--
-- Idempotent: uses UPDATE WHERE key=. Re-running is safe.

BEGIN;

UPDATE pricing_config
   SET value = 40,
       description = 'Markup % for parts cost < $50 (RockAuto wholesale-discount → retail)'
 WHERE key = 'parts_markup_tier1_pct';

UPDATE pricing_config
   SET value = 800,
       description = 'Hazmat disposal fee in cents ($8 per oil/coolant/brake-fluid service)'
 WHERE key = 'hazmat_disposal_fee';

COMMIT;
