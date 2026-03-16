"use client";

import { Calendar, DollarSign, FileText, Receipt, Users } from "lucide-react";
import Link from "next/link";
import { Spinner } from "@/components/ui/Spinner";
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
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-text-secondary">{label}</span>
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-display font-bold text-text">{value}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const { data, isLoading } = useAdminDashboard();

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const { stats, upcomingBookings, recentCustomers, pendingQuotes } = data;

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-text mb-1">
        Dashboard
      </h1>
      <p className="text-sm text-text-secondary mb-8">
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
            <h2 className="text-sm font-semibold text-text">
              Upcoming Bookings
            </h2>
            <Link
              href="/admin/bookings"
              className="text-xs text-red-primary hover:text-red-dark font-medium"
            >
              View all
            </Link>
          </div>
          {upcomingBookings.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-6 text-center">
              <p className="text-xs text-text-secondary">
                No upcoming bookings.
              </p>
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-xl divide-y divide-border">
              {upcomingBookings.map((b) => (
                <div key={b.id} className="px-4 py-3">
                  <p className="text-sm text-text font-medium truncate">
                    {b.serviceType}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {formatDate(b.scheduledAt)} &middot;{" "}
                    {b.customerName ?? "Unknown"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent customers */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text">
              Recent Customers
            </h2>
            <Link
              href="/admin/customers"
              className="text-xs text-red-primary hover:text-red-dark font-medium"
            >
              View all
            </Link>
          </div>
          {recentCustomers.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-6 text-center">
              <p className="text-xs text-text-secondary">No customers yet.</p>
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-xl divide-y divide-border">
              {recentCustomers.map((c) => (
                <Link
                  key={c.id}
                  href={`/admin/customers?id=${c.id}`}
                  className="block px-4 py-3 hover:bg-surface-alt transition-colors first:rounded-t-xl last:rounded-b-xl"
                >
                  <p className="text-sm text-text font-medium truncate">
                    {c.name ?? "Unnamed"}
                  </p>
                  <p className="text-xs text-text-secondary truncate">
                    {c.email ?? c.phone ?? "No contact info"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Pending quotes */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text">Pending Quotes</h2>
            <Link
              href="/admin/quotes"
              className="text-xs text-red-primary hover:text-red-dark font-medium"
            >
              View all
            </Link>
          </div>
          {pendingQuotes.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-6 text-center">
              <p className="text-xs text-text-secondary">No pending quotes.</p>
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-xl divide-y divide-border">
              {pendingQuotes.map((q) => (
                <div key={q.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-text font-medium">
                      {formatCents(q.totalAmount)}
                    </p>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full capitalize bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      {q.status}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {formatDate(q.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
