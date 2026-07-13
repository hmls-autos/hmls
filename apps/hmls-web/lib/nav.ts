import {
  Calendar,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  ClipboardList,
  LayoutDashboard,
  MessageSquare,
  User,
  Users,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

// Single source for section nav items — used by the dashboard sidebars
// (desktop) and MobileNav (the one mobile hamburger).
export const adminNavItems: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin/mechanics", label: "Mechanics", icon: Wrench },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/chat", label: "Chat", icon: MessageSquare },
];

export const portalNavItems: NavItem[] = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/orders", label: "My Orders", icon: ClipboardList },
  { href: "/portal/bookings", label: "Bookings", icon: Calendar },
  { href: "/portal/profile", label: "Profile", icon: User },
];

export const mechanicNavItems: NavItem[] = [
  { href: "/mechanic", label: "My Jobs", icon: CalendarCheck },
  { href: "/mechanic/availability", label: "Weekly Hours", icon: CalendarDays },
  { href: "/mechanic/time-off", label: "Time Off", icon: CalendarOff },
];

export type Section = "admin" | "portal" | "mechanic";

/** Which dashboard section a pathname belongs to, for the CURRENT viewer.
 *  Admin/mechanic paths only count when the viewer can actually use that
 *  section (roles are mutually exclusive; admins 403 on /mechanic). */
export function detectSection(
  pathname: string,
  roles: { isAdmin: boolean; isMechanic: boolean },
): Section | null {
  if (pathname.startsWith("/portal")) return "portal";
  if (pathname.startsWith("/admin") && roles.isAdmin) return "admin";
  if (pathname.startsWith("/mechanic") && roles.isMechanic) return "mechanic";
  return null;
}

export const sectionNavItems: Record<Section, NavItem[]> = {
  admin: adminNavItems,
  portal: portalNavItems,
  mechanic: mechanicNavItems,
};

// Shared link vocabulary — Navbar (desktop) and MobileNav must not each
// define their own copies.
export const marketingLinks = [
  { href: "/", label: "Home" },
  { href: "/contact", label: "Contact" },
] as const;

export const portalLink = { href: "/portal", label: "My Portal" } as const;
export const adminLink = { href: "/admin", label: "Admin" } as const;
export const mechanicLink = { href: "/mechanic", label: "Mechanic" } as const;
/** The single customer entry to /chat. The plain "Chat" text link is gone. */
export const chatCta = { href: "/chat", label: "Get a Quote" } as const;

/**
 * Active state for a link inside a section nav — exact match for the section
 * root (so it doesn't stay highlighted on sub-pages), prefix match for child
 * links. Use for sidebar / sub-nav link highlighting.
 */
export function isSectionNavActive(
  pathname: string,
  href: string,
  sectionRoot: string,
): boolean {
  return href === sectionRoot ? pathname === href : pathname.startsWith(href);
}
