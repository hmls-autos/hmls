"use client";

import { LogIn, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ShopSwitcher } from "@/components/admin/ShopSwitcher";
import {
  adminLink,
  chatCta,
  detectSection,
  isSectionNavActive,
  marketingLinks,
  mechanicLink,
  portalLink,
  sectionNavItems,
} from "@/lib/nav";
import ThemeToggle from "./ThemeToggle";

export default function MobileNav({
  isTransparent = false,
}: {
  isTransparent?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const { user, supabase, isLoading, isAdmin, isMechanic, isOwner } = useAuth();

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

  // Section sub-nav — the single mobile menu carries the dashboard nav
  // (the desktop sidebar's items) so dashboard pages don't need a second
  // hamburger of their own. Inside a section the menu stays focused: section
  // nav + links to the OTHER sections + theme/sign-out. Marketing links only
  // show outside sections (the logo already links home).
  const section = detectSection(pathname, { isAdmin, isMechanic });
  const subNav = section ? sectionNavItems[section] : null;
  const subNavRoot = subNav?.[0]?.href ?? "/";

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
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

            {!section &&
              marketingLinks.map(({ href, label }) => (
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
            {user && (
              <>
                {section !== "portal" && (
                  <Link
                    href={portalLink.href}
                    onClick={close}
                    className="text-sm text-text-secondary hover:text-text transition-colors"
                  >
                    {isAdmin ? "View as Customer" : portalLink.label}
                  </Link>
                )}
                {isAdmin && section !== "admin" && (
                  <Link
                    href={adminLink.href}
                    onClick={close}
                    className="text-sm text-text-secondary hover:text-text transition-colors"
                  >
                    {adminLink.label}
                  </Link>
                )}
                {/* Mechanics only — for admins this link mostly 403s (needs a
                    linked provider row) and reads confusingly next to the
                    admin "Mechanics" nav item. */}
                {isMechanic && section !== "mechanic" && (
                  <Link
                    href={mechanicLink.href}
                    onClick={close}
                    className="text-sm text-text-secondary hover:text-text transition-colors"
                  >
                    {mechanicLink.label}
                  </Link>
                )}
              </>
            )}
            {isOwner && (
              <div className="flex items-center gap-2">
                <ShopSwitcher />
              </div>
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
            {!isAdmin && !isMechanic && (
              <Link
                href={chatCta.href}
                onClick={close}
                className="px-4 py-3 bg-red-primary text-white text-center rounded-lg font-medium hover:bg-red-dark transition-colors"
              >
                {chatCta.label}
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
