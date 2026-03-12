"use client";

import {
  ChevronRight,
  ExternalLink,
  LogOut,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/components/AuthProvider";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8001";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function SettingsPage() {
  const { user, session, supabase } = useAuth();
  const { theme, setTheme } = useTheme();

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

  return (
    <div className="flex flex-col h-dvh">
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-sm border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-6">
        {/* Account */}
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            Account
          </h2>
          <div className="bg-surface-alt rounded-xl border border-border divide-y divide-border">
            <div className="px-4 py-3">
              <p className="text-sm text-text-secondary">Email</p>
              <p className="text-sm font-medium">{user?.email ?? "—"}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-red-500/5 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </section>

        {/* Subscription */}
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            Subscription
          </h2>
          <div className="bg-surface-alt rounded-xl border border-border divide-y divide-border">
            <div className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Current Plan</p>
                <p className="text-sm font-medium">Free</p>
              </div>
              <a
                href="/pricing"
                className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium"
              >
                Upgrade
              </a>
            </div>
            <button
              type="button"
              onClick={handleManageSubscription}
              className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-surface transition-colors"
            >
              <span>Manage Subscription</span>
              <ChevronRight className="w-4 h-4 text-text-secondary" />
            </button>
          </div>
        </section>

        {/* Theme */}
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            Appearance
          </h2>
          <div className="bg-surface-alt rounded-xl border border-border p-1 flex gap-1">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  theme === value
                    ? "bg-primary text-white"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* About */}
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            About
          </h2>
          <div className="bg-surface-alt rounded-xl border border-border divide-y divide-border">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm">Version</span>
              <span className="text-sm text-text-secondary">0.1.0</span>
            </div>
            <a
              href="/privacy"
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface transition-colors"
            >
              <span>Privacy Policy</span>
              <ExternalLink className="w-4 h-4 text-text-secondary" />
            </a>
            <a
              href="/terms"
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface transition-colors"
            >
              <span>Terms of Service</span>
              <ExternalLink className="w-4 h-4 text-text-secondary" />
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
