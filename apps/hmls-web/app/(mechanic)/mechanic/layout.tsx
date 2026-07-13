"use client";

import { DashboardLayout } from "@/components/DashboardLayout";
import Navbar from "@/components/Navbar";
import { mechanicNavItems } from "@/lib/nav";

export default function MechanicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      <DashboardLayout
        navItems={mechanicNavItems}
        maxWidth="max-w-5xl"
        mechanicCheck
        adminPanelLabel="Mechanic Panel"
      >
        {children}
      </DashboardLayout>
    </>
  );
}
