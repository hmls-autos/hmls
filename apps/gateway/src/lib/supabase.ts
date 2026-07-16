import { env } from "@hmls/shared/env";
import { createClient } from "@supabase/supabase-js";

let _supabase: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (!_supabase) {
    const url = env("SUPABASE_URL");
    const anonKey = env("SUPABASE_ANON_KEY");
    if (!url || !anonKey) {
      throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
    }
    _supabase = createClient(url, anonKey);
  }
  return _supabase;
}

export interface AuthUser {
  id: string;
  email: string;
  /** Role from the JWT's `user_role` claim (populated by custom_access_token_hook). */
  role: string;
  /** Mechanic provider ID — only set when role === "mechanic". */
  providerId?: number;
}

/**
 * Best-effort decode of a JWT's payload. Does NOT verify — callers must verify
 * the token via Supabase first. We only read custom claims here.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return {};
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  const {
    data: { user },
    error,
  } = await getSupabase().auth.getUser(token);

  if (error || !user) {
    return null;
  }

  // Custom claims injected by public.custom_access_token_hook.
  // The hook bridges legacy app_metadata admins internally, so we don't
  // need an application-side fallback.
  const claims = decodeJwtPayload(token);
  const role = (claims.user_role as string) ?? "customer";
  const providerId = typeof claims.provider_id === "number"
    ? (claims.provider_id as number)
    : undefined;

  return {
    id: user.id,
    email: user.email!,
    role,
    providerId,
  };
}
