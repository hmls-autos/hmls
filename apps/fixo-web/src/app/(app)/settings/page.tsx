"use client";

import {
  ChevronRight,
  ExternalLink,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { UpgradeModal } from "@/components/UpgradeModal";
import { AGENT_URL } from "@/lib/config";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

interface BalanceResponse {
  unlimited: boolean;
  monthly: number;
  topup: number;
  total: number | null;
  tier: "free" | "plus" | "pro";
}

export default function SettingsPage() {
  const { user, session, supabase } = useAuth();
  const { theme, setTheme } = useTheme();
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [showTopup, setShowTopup] = useState(false);

  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    fetch(`${AGENT_URL}/billing/balance`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BalanceResponse | null) => {
        if (!cancelled) setBalance(data);
      })
      .catch(() => {
        /* leave balance null — UI shows skeleton */
      });
    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const handleManageSubscription = async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(`${AGENT_URL}/billing/portal`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      }
    } catch {
      // silently fail
    }
  };

  const planLabel =
    balance?.tier === "pro"
      ? "Pro"
      : balance?.tier === "plus"
        ? "Plus"
        : "Free";

  return (
    <div className="flex h-dvh flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background px-4">
        <h1 className="text-[15px] font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 pb-24">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Account */}
          <section>
            <h2 className="mb-2.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Account
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="mt-0.5 text-sm font-medium">
                  {user?.email ?? "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-500 dark:hover:bg-red-900/10"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          </section>

          {/* Credits */}
          <section>
            <h2 className="mb-2.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Credits
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {balance?.unlimited ? (
                <div className="px-4 py-4">
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="mt-0.5 text-sm font-medium">Unlimited</p>
                </div>
              ) : (
                <div className="px-4 py-4">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">Balance</p>
                    {balance && (
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {planLabel} plan
                      </p>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-2xl font-medium tabular-nums">
                    {balance ? (balance.total ?? 0).toLocaleString() : "—"}
                  </p>
                  {balance && (
                    <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
                      <span>
                        <span className="tabular-nums">
                          {balance.monthly.toLocaleString()}
                        </span>{" "}
                        monthly
                      </span>
                      <span>
                        <span className="tabular-nums">
                          {balance.topup.toLocaleString()}
                        </span>{" "}
                        top-up
                      </span>
                    </div>
                  )}
                </div>
              )}
              {!balance?.unlimited && (
                <button
                  type="button"
                  onClick={() => setShowTopup(true)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                    Buy more credits
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </section>

          {/* Subscription */}
          <section>
            <h2 className="mb-2.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Subscription
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-xs text-muted-foreground">Current plan</p>
                  <p className="mt-0.5 text-sm font-medium">{planLabel}</p>
                </div>
                {balance?.tier === "free" && (
                  <a
                    href="/pricing"
                    className="inline-flex items-center justify-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
                  >
                    Upgrade
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={handleManageSubscription}
                className="flex w-full items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-muted"
              >
                <span>Manage subscription</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </section>

          {/* Theme */}
          <section>
            <h2 className="mb-2.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Appearance
            </h2>
            <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors ${
                    theme === value
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* About */}
          <section>
            <h2 className="mb-2.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              About
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">Version</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  0.1.0
                </span>
              </div>
              <a
                href="/privacy"
                className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-muted"
              >
                <span>Privacy policy</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </a>
              <a
                href="/terms"
                className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-muted"
              >
                <span>Terms of service</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </a>
            </div>
          </section>
        </div>
      </div>

      {showTopup && (
        <UpgradeModal
          message="Pick a credit pack or upgrade to Plus for monthly credits + a discount."
          onClose={() => setShowTopup(false)}
        />
      )}
    </div>
  );
}
