"use client";

import { DashboardLayout } from "@/components/DashboardLayout";
import Navbar from "@/components/Navbar";
import { portalNavItems } from "@/lib/nav";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      <DashboardLayout navItems={portalNavItems} portalCheck>
        {children}
      </DashboardLayout>
    </>
  );
}
