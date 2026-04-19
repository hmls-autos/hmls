"use client";

import { BarChart3, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/fetcher";
import { isSectionNavActive } from "@/lib/nav";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export function DashboardLayout({
  navItems,
  title,
  maxWidth = "max-w-5xl",
  adminCheck,
  adminPanelLabel,
  fullHeight,
  children,
}: {
  navItems: NavItem[];
  title: string;
  maxWidth?: string;
  adminCheck?: boolean;
  adminPanelLabel?: string;
  /** When true, children fill the remaining height with no padding wrapper */
  fullHeight?: boolean;
  children: React.ReactNode;
}) {
  const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
  const { session, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { error: adminError, isLoading: adminLoading } = useSWR(
    adminCheck && (session || skipAuth) ? "/api/admin/dashboard" : null,
    fetcher,
  );

  useEffect(() => {
    if (!skipAuth && !authLoading && !session) {
      router.push("/login");
    }
  }, [skipAuth, authLoading, session, router]);

  // Close sidebar on route change (mobile)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally close sidebar when pathname changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const isLoading = !skipAuth && (authLoading || (adminCheck && adminLoading));

  if (isLoading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Skeleton className="h-8 w-8 rounded-full" />
      </main>
    );
  }

  if (!skipAuth && !session) return null;

  if (!skipAuth && adminCheck && adminError) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h1 className="text-lg font-display font-bold text-foreground mb-1">
            Access Denied
          </h1>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have admin access.
          </p>
        </div>
      </main>
    );
  }

  const basePath = navItems[0]?.href ?? "/";

  const navContent = (
    <>
      {adminPanelLabel && (
        <div className="px-4 mb-4 hidden md:block">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
    </>
  );

  return (
    <div className="flex flex-1 min-h-0">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex sticky top-16 z-auto h-[calc(100dvh-4rem)] w-60 bg-sidebar-background border-r border-sidebar-border flex-col py-4">
        <div className="px-5 mb-4">
          <span className="text-lg font-display font-extrabold tracking-tight text-foreground">
            HMLS<span className="text-red-500">.</span>
          </span>
        </div>
        {navContent}
      </aside>

      {/* Mobile Sheet sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-60 p-0 pt-4">
          <SheetHeader className="px-4 pb-2">
            <SheetTitle className="text-sm font-medium text-muted-foreground">
              {title}
            </SheetTitle>
          </SheetHeader>
          {navContent}
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <main
        className={`flex-1 min-w-0 ${fullHeight ? "flex flex-col min-h-0" : ""}`}
      >
        {/* Mobile hamburger */}
        <div className="flex md:hidden items-center gap-2 px-4 py-3 border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="h-8 w-8"
          >
            <Menu className="w-5 h-5" />
          </Button>
          <span className="text-sm font-medium text-muted-foreground">
            {title}
          </span>
        </div>
        {fullHeight ? (
          <div className="flex flex-col flex-1 min-h-0">{children}</div>
        ) : (
          <div className={`p-4 md:p-8 ${maxWidth} mx-auto`}>{children}</div>
        )}
      </main>
    </div>
  );
}
