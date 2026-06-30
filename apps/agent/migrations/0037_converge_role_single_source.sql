-- 0037: converge auth role to a SINGLE source of truth — public.customers.role.
--
-- Before: custom_access_token_hook read customers.role, and when that was
-- NULL/'customer' it fell back to auth.users.raw_app_meta_data->>'role'. Role
-- thus lived in two stores that drifted (e.g. an account 'customer' in
-- customers but 'admin' in auth metadata). "Who is an admin?" depended on which
-- store you queried — an audit/footgun.
--
-- After: the hook reads ONLY customers.role (default 'customer'). Grant/revoke
-- a role by writing customers.role; auth app_metadata 'role' is no longer
-- consulted. Verified safe before applying: 0 accounts had an elevated role
-- ONLY in auth metadata (all such accounts already carry customers.role).
--
-- CREATE OR REPLACE keeps existing privileges (supabase_auth_admin EXECUTE +
-- SELECT on customers), so no re-GRANT is needed. The function no longer reads
-- auth.users, so it needs strictly fewer privileges than before. Idempotent.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE
  AS $function$
DECLARE
  claims jsonb;
  v_user_id text;
  v_role text;
BEGIN
  v_user_id := event->>'user_id';
  -- Defensive: GoTrue always sends 'claims', but COALESCE guarantees we never
  -- return a NULL event (which would 500 the token mint and lock out logins).
  claims := COALESCE(event->'claims', '{}'::jsonb);

  SELECT role INTO v_role
  FROM public.customers
  WHERE auth_user_id = v_user_id
  LIMIT 1;

  IF v_role IS NULL THEN
    v_role := 'customer';
  END IF;

  claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$function$;
