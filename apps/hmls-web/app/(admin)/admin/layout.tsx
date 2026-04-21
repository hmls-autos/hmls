"use client";

import {
  ClipboardList,
  LayoutDashboard,
  MessageSquare,
  Users,
  Wrench,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { DashboardLayout, type NavItem } from "@/components/DashboardLayout";
import Navbar from "@/components/Navbar";

const navItems: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin/mechanics", label: "Mechanics", icon: Wrench },
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
    <>
      <Navbar />
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
    </>
  );
}
