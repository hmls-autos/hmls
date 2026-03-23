"use client";

import { Calendar, DollarSign, FileText, Receipt, Users } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminDashboard } from "@/hooks/useAdmin";
import { formatCents, formatDate } from "@/lib/format";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <Card className="gap-0 p-5">
      <CardContent className="p-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">{label}</span>
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <p className="text-2xl font-display font-bold text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card className="gap-0 p-5">
      <CardContent className="p-0">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
        <Skeleton className="h-8 w-24" />
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <Skeleton className="h-8 w-40 mb-1" />
      <Skeleton className="h-4 w-56 mb-8" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
        {["stat-1", "stat-2", "stat-3", "stat-4", "stat-5"].map((id) => (
          <StatCardSkeleton key={id} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {["col-1", "col-2", "col-3"].map((colId) => (
          <div key={colId}>
            <div className="flex items-center justify-between mb-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Card className="gap-0 p-0">
              <CardContent className="p-0 divide-y divide-border">
                {["row-1", "row-2", "row-3"].map((rowId) => (
                  <div key={rowId} className="px-4 py-3">
                    <Skeleton className="h-4 w-3/4 mb-1.5" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { data, isLoading } = useAdminDashboard();

  if (isLoading || !data) {
    return <DashboardSkeleton />;
  }

  const { stats, upcomingBookings, recentCustomers, pendingQuotes } = data;

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-foreground mb-1">
        Dashboard
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        Business overview at a glance.
      </p>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
        <StatCard
          label="Customers"
          value={stats.customers}
          icon={Users}
          color="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        />
        <StatCard
          label="Bookings"
          value={stats.bookings}
          icon={Calendar}
          color="bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
        />
        <StatCard
          label="Estimates"
          value={stats.estimates}
          icon={FileText}
          color="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
        />
        <StatCard
          label="Quotes"
          value={stats.quotes}
          icon={Receipt}
          color="bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
        />
        <StatCard
          label="Revenue (30d)"
          value={formatCents(stats.revenue30d)}
          icon={DollarSign}
          color="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming bookings */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Upcoming Bookings
            </h2>
            <Link
              href="/admin/orders?status=scheduled"
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              View all
            </Link>
          </div>
          {upcomingBookings.length === 0 ? (
            <Card className="gap-0 p-6 text-center">
              <CardContent className="p-0">
                <p className="text-xs text-muted-foreground">
                  No upcoming bookings.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="gap-0 p-0">
              <CardContent className="p-0 divide-y divide-border">
                {upcomingBookings.map((b) => (
                  <div key={b.id} className="px-4 py-3">
                    <p className="text-sm text-foreground font-medium truncate">
                      {b.serviceType}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(b.scheduledAt)} &middot;{" "}
                      {b.customerName ?? "Unknown"}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recent customers */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Recent Customers
            </h2>
            <Link
              href="/admin/customers"
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              View all
            </Link>
          </div>
          {recentCustomers.length === 0 ? (
            <Card className="gap-0 p-6 text-center">
              <CardContent className="p-0">
                <p className="text-xs text-muted-foreground">
                  No customers yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="gap-0 p-0 overflow-hidden">
              <CardContent className="p-0 divide-y divide-border">
                {recentCustomers.map((c) => (
                  <Link
                    key={c.id}
                    href={`/admin/customers?id=${c.id}`}
                    className="block px-4 py-3 hover:bg-muted transition-colors"
                  >
                    <p className="text-sm text-foreground font-medium truncate">
                      {c.name ?? "Unnamed"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.email ?? c.phone ?? "No contact info"}
                    </p>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Pending quotes */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Pending Quotes
            </h2>
            <Link
              href="/admin/orders?status=sent"
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              View all
            </Link>
          </div>
          {pendingQuotes.length === 0 ? (
            <Card className="gap-0 p-6 text-center">
              <CardContent className="p-0">
                <p className="text-xs text-muted-foreground">
                  No pending quotes.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="gap-0 p-0">
              <CardContent className="p-0 divide-y divide-border">
                {pendingQuotes.map((q) => (
                  <div key={q.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-foreground font-medium">
                        {formatCents(q.totalAmount)}
                      </p>
                      <Badge
                        variant="outline"
                        className="capitalize bg-amber-100 text-amber-700 border-transparent dark:bg-amber-900/30 dark:text-amber-400"
                      >
                        {q.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(q.createdAt)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
