"use client";

import { usePathname } from "next/navigation";
import { DashboardLayout } from "@/components/DashboardLayout";
import Navbar from "@/components/Navbar";
import { adminNavItems } from "@/lib/nav";

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
        navItems={adminNavItems}
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
