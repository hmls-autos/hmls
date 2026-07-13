import { type NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next")) ?? "/chat";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Customer record is auto-created/linked by DB trigger on auth.users INSERT
      return NextResponse.redirect(new URL(next, request.nextUrl.origin));
    }
  }

  // Auth failed — redirect to login with error
  const failure = new URL("/login", request.nextUrl.origin);
  failure.searchParams.set("error", "Could not authenticate");
  return NextResponse.redirect(failure);
}
