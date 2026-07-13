"use client";

import { LogIn, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ShopSwitcher } from "@/components/admin/ShopSwitcher";
import { useSignOut } from "@/hooks/useSignOut";
import {
  adminLink,
  chatCta,
  detectSection,
  marketingLinks,
  mechanicLink,
  portalLink,
} from "@/lib/nav";
import MobileNav from "./MobileNav";
import ThemeToggle from "./ThemeToggle";

export default function Navbar() {
  const pathname = usePathname();
  const { user, isLoading, isAdmin, isMechanic, isOwner } = useAuth();
  const signOut = useSignOut();
  const isUserLoggedIn = !!user;
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const section = detectSection(pathname, { isAdmin, isMechanic });

  useEffect(() => {
    if (!isHome) return;
    const onScroll = () => setScrolled(window.scrollY > 50);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHome]);

  const isTransparent = isHome && !scrolled;

  const linkCls = (active: boolean) =>
    `text-sm transition-colors rounded focus-visible:ring-2 focus-visible:ring-red-primary ${
      active
        ? "text-red-400"
        : isTransparent
          ? "text-white/70 hover:text-white"
          : "text-text-secondary hover:text-text"
    }`;

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        isTransparent
          ? "bg-transparent border-b border-transparent"
          : "bg-background border-b border-border"
      }`}
    >
      <nav className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link
          href="/"
          className={`text-xl font-display font-semibold tracking-tight transition-colors ${
            isTransparent ? "text-white" : "text-text"
          }`}
        >
          HMLS<span className="text-red-primary">.</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          {!section &&
            marketingLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                prefetch={false}
                className={linkCls(pathname === href)}
              >
                {label}
              </Link>
            ))}
          {isUserLoggedIn && section !== "portal" && (
            <Link
              href={portalLink.href}
              prefetch={false}
              className={linkCls(false)}
            >
              {isAdmin ? "View as Customer" : portalLink.label}
            </Link>
          )}
          {isAdmin && section !== "admin" && (
            <Link
              href={adminLink.href}
              prefetch={false}
              className={linkCls(false)}
            >
              {adminLink.label}
            </Link>
          )}
          {isMechanic && section !== "mechanic" && (
            <Link
              href={mechanicLink.href}
              prefetch={false}
              className={linkCls(false)}
            >
              {mechanicLink.label}
            </Link>
          )}
          {isOwner && <ShopSwitcher />}
          <ThemeToggle />
          {!isLoading &&
            (isUserLoggedIn ? (
              <button
                type="button"
                onClick={() => void signOut()}
                className={`flex items-center gap-2 text-sm transition-colors rounded focus-visible:ring-2 focus-visible:ring-red-primary ${
                  isTransparent
                    ? "text-white/70 hover:text-white"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            ) : (
              <Link
                href="/login"
                prefetch={false}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  isTransparent
                    ? "border-white/30 text-white hover:border-white/60"
                    : "border-border text-text hover:border-red-500/50 hover:text-red-400"
                }`}
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </Link>
            ))}
          {!isAdmin && !isMechanic && (
            <Link
              href={chatCta.href}
              prefetch={false}
              className="px-5 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
            >
              {chatCta.label}
            </Link>
          )}
        </div>

        {/* Mobile nav */}
        <MobileNav isTransparent={isTransparent} />
      </nav>
    </header>
  );
}
