import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Route prefixes that require any authenticated Supabase session. */
const AUTH_PREFIXES = ["/chat", "/portal", "/admin"];

/** Route prefixes that additionally require an admin role. */
const ADMIN_PREFIXES = ["/admin"];

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "Supabase env vars are missing; skipping auth middleware. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Refresh the session cookie on every request so the client-side
  // AuthProvider and the gateway both see a fresh token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const needsAuth = matchesPrefix(pathname, AUTH_PREFIXES);
  const needsAdmin = matchesPrefix(pathname, ADMIN_PREFIXES);

  // Unauthenticated visitors to protected routes go to /login.
  if (!user && needsAuth) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  // Non-admins hitting /admin/* go to the portal (gateway still enforces this
  // server-side; this is just the UX-level bounce so they don't see the shell).
  if (user && needsAdmin && user.app_metadata?.role !== "admin") {
    const portalUrl = request.nextUrl.clone();
    portalUrl.pathname = "/portal";
    portalUrl.search = "";
    return NextResponse.redirect(portalUrl);
  }

  // Already-authenticated users shouldn't see the login page.
  if (user && pathname === "/login") {
    const chatUrl = request.nextUrl.clone();
    chatUrl.pathname = "/chat";
    chatUrl.search = "";
    return NextResponse.redirect(chatUrl);
  }

  return response;
}

export const config = {
  // Skip static assets, the Next.js image optimizer, and internal paths.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
