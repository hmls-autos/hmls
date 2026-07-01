-- Rollback for 0039: revert to app-layer-only isolation instantly. tenant_app
-- keeps its grants, so the app keeps working with RLS off.
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE providers DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_intake DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE provider_availability DISABLE ROW LEVEL SECURITY;
ALTER TABLE provider_schedule_overrides DISABLE ROW LEVEL SECURITY;
