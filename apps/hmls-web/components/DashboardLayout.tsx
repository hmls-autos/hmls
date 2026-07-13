"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import useSWR from "swr";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/useApi";
import { isSectionNavActive, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function DashboardLayout({
  navItems,
  maxWidth = "max-w-5xl",
  adminCheck,
  mechanicCheck,
  adminPanelLabel,
  fullHeight,
  children,
}: {
  navItems: NavItem[];
  maxWidth?: string;
  adminCheck?: boolean;
  mechanicCheck?: boolean;
  adminPanelLabel?: string;
  /** When true, children fill the remaining height with no padding wrapper */
  fullHeight?: boolean;
  children: React.ReactNode;
}) {
  const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
  const { session, isLoading: authLoading } = useAuth();
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const guardEndpoint = adminCheck
    ? "/api/admin/me"
    : mechanicCheck
      ? "/api/mechanic/me"
      : null;
  const { error: adminError, isLoading: adminLoading } = useSWR(
    guardEndpoint && (session || skipAuth) ? guardEndpoint : null,
    (p: string) => api.get<unknown>(p),
  );

  useEffect(() => {
    if (!skipAuth && !authLoading && !session) {
      const qs = searchParams.toString();
      const next = qs ? `${pathname}?${qs}` : pathname;
      router.push(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [skipAuth, authLoading, session, router, pathname, searchParams]);

  const isLoading =
    !skipAuth &&
    (authLoading || ((adminCheck || mechanicCheck) && adminLoading));

  if (isLoading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Skeleton className="h-8 w-8 rounded-full" />
      </main>
    );
  }

  if (!skipAuth && !session) return null;

  if (!skipAuth && (adminCheck || mechanicCheck) && adminError) {
    const deniedRoleLabel = adminCheck ? "admin" : "mechanic";
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h1 className="text-lg font-display font-semibold text-foreground mb-1">
            Access Denied
          </h1>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have {deniedRoleLabel} access.
          </p>
        </div>
      </main>
    );
  }

  const basePath = navItems[0]?.href ?? "/";

  return (
    <div className="flex flex-1 min-h-0">
      {/* Desktop sidebar — logo lives in the top Navbar, not here.
          On mobile the section nav lives inside MobileNav (single hamburger). */}
      <aside className="hidden md:flex sticky top-16 z-auto h-[calc(100dvh-4rem)] w-60 bg-sidebar-background border-r border-sidebar-border flex-col py-4">
        {adminPanelLabel && (
          <div className="px-4 mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider font-mono text-muted-foreground">
              {adminPanelLabel}
            </span>
          </div>
        )}
        <nav className="flex flex-col gap-1 px-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = isSectionNavActive(pathname, href, basePath);
            return (
              <Button
                key={href}
                variant="ghost"
                asChild
                className={cn(
                  "justify-start gap-3 h-auto px-3 py-2.5 text-sm font-medium",
                  isActive
                    ? "bg-red-500/10 text-red-500 hover:bg-red-500/15 dark:text-red-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Link href={href}>
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </Link>
              </Button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main
        className={`flex-1 min-w-0 ${fullHeight ? "flex flex-col min-h-0" : ""}`}
      >
        {fullHeight ? (
          <div className="flex flex-col flex-1 min-h-0">{children}</div>
        ) : (
          <div className={`p-4 md:p-8 ${maxWidth} mx-auto`}>{children}</div>
        )}
      </main>
    </div>
  );
}
