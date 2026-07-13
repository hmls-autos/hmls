"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";

/** Sign out and land on the homepage — NOT on the section guard's /login
 *  redirect, which reads as a failed sign-out. */
export function useSignOut() {
  const { supabase } = useAuth();
  const router = useRouter();
  return useCallback(async () => {
    await supabase.auth.signOut();
    router.push("/");
  }, [supabase, router]);
}
