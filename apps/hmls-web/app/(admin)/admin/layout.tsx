"use client";

import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  MessageSquare,
  Users,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { DashboardLayout, type NavItem } from "@/components/DashboardLayout";

const navItems: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/chat", label: "Chat", icon: MessageSquare },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isChatPage = pathname.startsWith("/admin/chat");

  return (
    <DashboardLayout
      navItems={navItems}
      title="Admin"
      maxWidth="max-w-6xl"
      adminCheck
      adminPanelLabel="Admin Panel"
      fullHeight={isChatPage}
    >
      {children}
    </DashboardLayout>
  );
}
