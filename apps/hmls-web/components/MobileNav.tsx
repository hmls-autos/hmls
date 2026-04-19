"use client";

import {
  ClipboardList,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  User,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { isSectionNavActive } from "@/lib/nav";
import ThemeToggle from "./ThemeToggle";

const marketingLinks = [
  { href: "/", label: "Home" },
  { href: "/contact", label: "Contact" },
];
const customerChatLink = { href: "/chat", label: "Chat" };

const portalLink = { href: "/portal", label: "My Portal" };
const adminLink = { href: "/admin", label: "Admin" };
const mechanicLink = { href: "/mechanic", label: "Mechanic" };

const portalSubNav = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/orders", label: "My Orders", icon: ClipboardList },
  { href: "/portal/profile", label: "Profile", icon: User },
];

const adminSubNav = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin/customers", label: "Customers", icon: Users },
];

export default function MobileNav({
  isTransparent = false,
}: {
  isTransparent?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const { user, supabase, isLoading, isAdmin, isMechanic } = useAuth();

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  // Close mobile nav on route change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on pathname change
  useEffect(() => {
    close();
  }, [pathname, close]);

  const isOnPortal = pathname.startsWith("/portal");
  const isOnAdmin = pathname.startsWith("/admin");
  const subNav = isOnPortal
    ? portalSubNav
    : isOnAdmin && isAdmin
      ? adminSubNav
      : null;
  const subNavRoot = isOnPortal ? "/portal" : "/admin";

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 focus-visible:ring-2 focus-visible:ring-red-primary rounded-lg transition-colors ${
          isTransparent && !isOpen ? "text-white" : "text-text"
        }`}
        aria-label="Toggle menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {isOpen && (
        <nav
          aria-label="Mobile navigation"
          className="absolute top-16 left-0 right-0 bg-surface border-b border-border p-6 shadow-lg"
        >
          <div className="flex flex-col gap-4">
            {/* Sub-nav for portal/admin pages */}
            {subNav && (
              <>
                <div className="flex flex-col gap-1">
                  {subNav.map(({ href, label, icon: Icon }) => {
                    const isActive = isSectionNavActive(
                      pathname,
                      href,
                      subNavRoot,
                    );
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={close}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-red-light text-red-primary"
                            : "text-text-secondary hover:text-text hover:bg-surface-alt"
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {label}
                      </Link>
                    );
                  })}
                </div>
                <div className="border-t border-border" />
              </>
            )}

            {marketingLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={close}
                className={`text-sm transition-colors ${
                  pathname === href
                    ? "text-red-400 font-medium"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                {label}
              </Link>
            ))}
            {!isAdmin && (
              <Link
                href={customerChatLink.href}
                onClick={close}
                className={`text-sm transition-colors ${
                  pathname === customerChatLink.href
                    ? "text-red-400 font-medium"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                {customerChatLink.label}
              </Link>
            )}
            {user && (
              <>
                {!isAdmin && (
                  <Link
                    href={portalLink.href}
                    onClick={close}
                    className={`text-sm transition-colors ${
                      pathname.startsWith(portalLink.href)
                        ? "text-red-400 font-medium"
                        : "text-text-secondary hover:text-text"
                    }`}
                  >
                    {portalLink.label}
                  </Link>
                )}
                {isAdmin && (
                  <Link
                    href={adminLink.href}
                    onClick={close}
                    className={`text-sm transition-colors ${
                      pathname.startsWith(adminLink.href)
                        ? "text-red-400 font-medium"
                        : "text-text-secondary hover:text-text"
                    }`}
                  >
                    {adminLink.label}
                  </Link>
                )}
                {isMechanic && (
                  <Link
                    href={mechanicLink.href}
                    onClick={close}
                    className={`text-sm transition-colors ${
                      pathname.startsWith(mechanicLink.href)
                        ? "text-red-400 font-medium"
                        : "text-text-secondary hover:text-text"
                    }`}
                  >
                    {mechanicLink.label}
                  </Link>
                )}
              </>
            )}
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <span className="text-sm text-text-secondary">Theme</span>
            </div>
            {!isLoading &&
              (user ? (
                <button
                  type="button"
                  onClick={() => {
                    supabase.auth.signOut();
                    close();
                  }}
                  className="flex items-center gap-2 text-sm text-text-secondary hover:text-text transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              ) : (
                <Link
                  href="/login"
                  onClick={close}
                  className="flex items-center gap-2 text-sm text-text-secondary hover:text-text transition-colors"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In
                </Link>
              ))}
            {!isAdmin && (
              <Link
                href="/chat"
                onClick={close}
                className="px-4 py-3 bg-red-primary text-white text-center rounded-lg font-medium hover:bg-red-dark transition-colors"
              >
                Get a Quote
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
