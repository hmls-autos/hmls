-- Decouple `provider_id` claim from the `mechanic` role.
--
-- Original hook (migration 0006) treated "active provider" as an exclusive role
-- — being linked to a `providers` row forced your JWT user_role to `mechanic`,
-- so admins who own a shop and want to act as mechanics couldn't do both. The
-- gateway worked around it by adding a DB lookup in `requireMechanic`, which
-- defeats the point of token-based auth (extra round trip per request, can
-- diverge from the JWT until next refresh).
--
-- New shape:
--   * `provider_id` claim is set whenever an active provider links to this
--     auth user, regardless of role.
--   * `user_role` falls back to customers.role / app_metadata.role / "customer"
--     in the same order as before — but is no longer hijacked by mechanic
--     linkage.
--   * `requireMechanic` can now trust `provider_id` from the token alone.
--
-- After applying, the gateway middleware should drop the `providerIdForAdmin`
-- DB-lookup fallback.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  v_user_id text;
  v_role text;
  v_provider_id integer;
BEGIN
  v_user_id := event->>'user_id';
  claims := event->'claims';

  -- Always pull provider_id if linked, independent of role.
  SELECT id INTO v_provider_id
  FROM public.providers
  WHERE auth_user_id = v_user_id
    AND is_active = true
  LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{provider_id}', to_jsonb(v_provider_id));
  END IF;

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

  -- Fallback: a linked provider with no other role record is a pure mechanic.
  IF v_role IS NULL AND v_provider_id IS NOT NULL THEN
    v_role := 'mechanic';
  END IF;

  IF v_role IS NULL THEN
    v_role := 'customer';
  END IF;

  claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;
