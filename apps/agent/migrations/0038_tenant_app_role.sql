-- 0038: create the non-BYPASSRLS application role used to enforce RLS.
-- Idempotent. Does NOT enable RLS (that is 0039). With no policies yet,
-- tenant_app can read everything, so shipping the code split (Tasks 1-4) is
-- behavior-neutral until 0039 flips RLS on.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_app') THEN
    CREATE ROLE tenant_app LOGIN NOINHERIT;
  END IF;
END $$;

-- Password is set out-of-band (never in the tracked migration):
--   ALTER ROLE tenant_app WITH PASSWORD '<from-secret-manager>';
-- TENANT_DATABASE_URL then connects as this role.

GRANT USAGE ON SCHEMA public TO tenant_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenant_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tenant_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tenant_app;
-- Future objects created by the migration owner:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tenant_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tenant_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO tenant_app;
