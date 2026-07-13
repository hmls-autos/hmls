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
  { href: "/mechanic", label: "My Bookings", icon: CalendarCheck },
  { href: "/mechanic/availability", label: "Weekly Hours", icon: CalendarDays },
  { href: "/mechanic/time-off", label: "Time Off", icon: CalendarOff },
];

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
