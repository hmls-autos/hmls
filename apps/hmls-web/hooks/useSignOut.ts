"use client";

import { useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";

/** Sign out and land on the homepage — NOT on the section guard's /login
 *  redirect, which reads as a failed sign-out. Hard navigation on purpose:
 *  a client-side router.push("/") loses the race against the guards'
 *  router.push("/login") that fires when the session nulls, and the full
 *  reload also wipes per-user SWR caches. */
export function useSignOut() {
  const { supabase } = useAuth();
  return useCallback(async () => {
    await supabase.auth.signOut();
    window.location.assign("/");
  }, [supabase]);
}
