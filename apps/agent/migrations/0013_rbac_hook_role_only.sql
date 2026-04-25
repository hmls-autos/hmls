-- Simplify the RBAC hook back to role-only: drop provider_id injection.
--
-- Migration 0012 added a `provider_id` claim so the gateway could trust the
-- JWT alone. But that pulled providers/customers reads into the auth hook,
-- which collided with row-level security (the hook runs as
-- `supabase_auth_admin` and got blocked by RLS, silently returning a NULL
-- provider_id). The fix was SECURITY DEFINER, but the underlying question
-- was: do we even need `provider_id` in the JWT?
--
-- Answer: no. The mechanic gate is just "is this user an admin or a
-- mechanic role?" — the actual providers row needed for queries can be
-- resolved per-request via `WHERE auth_user_id = sub` (sub is a free JWT
-- claim already). One uniform DB lookup for both roles, no hook coupling
-- to a DB-internal id, no RLS workarounds.
--
-- After this:
--   * hook only sets `user_role` (admin / mechanic / customer), no
--     `provider_id` claim.
--   * SECURITY DEFINER reverted to STABLE since the hook no longer reads
--     RLS-protected tables outside auth schema.
--   * gateway middleware does role check + a single providers lookup by
--     `auth_user_id` for both admin and mechanic paths.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  v_user_id text;
  v_role text;
BEGIN
  v_user_id := event->>'user_id';
  claims := event->'claims';

  -- Role: customers table → legacy app_metadata bridge → default customer.
  SELECT role INTO v_role
  FROM public.customers
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF v_role IS NULL OR v_role = 'customer' THEN
    SELECT COALESCE(raw_app_meta_data->>'role', v_role)
    INTO v_role
    FROM auth.users
    WHERE id::text = v_user_id
    LIMIT 1;
  END IF;

  IF v_role IS NULL THEN
    v_role := 'customer';
  END IF;

  claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

ALTER FUNCTION public.custom_access_token_hook(jsonb) SECURITY INVOKER;
