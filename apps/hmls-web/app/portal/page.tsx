"use client";

import { CheckCircle, ClipboardList, Loader } from "lucide-react";
import Link from "next/link";
import { Spinner } from "@/components/ui/Spinner";
import { usePortalCustomer, usePortalOrders } from "@/hooks/usePortal";
import { formatCents, formatDateTime } from "@/lib/format";
import { PORTAL_ORDER_STATUS } from "@/lib/status";

function SummaryCard({
  label,
  count,
  icon: Icon,
  href,
  color,
}: {
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="bg-surface border border-border rounded-xl p-5 hover:border-border-hover transition-colors group"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-text-secondary">{label}</span>
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-display font-bold text-text">{count}</p>
    </Link>
  );
}

export default function PortalDashboard() {
  const { customer, isLoading: customerLoading } = usePortalCustomer();
  const { orders, isLoading: ordersLoading } = usePortalOrders();

  const isLoading = customerLoading || ordersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const pendingAction = orders.filter(
    (o) => o.status === "estimated" || o.status === "approved",
  ).length;

  const activeOrders = orders.filter((o) =>
    ["preauth", "scheduled", "in_progress"].includes(o.status),
  ).length;

  const completed = orders.filter((o) =>
    ["paid", "completed"].includes(o.status),
  ).length;

  const recentOrders = [...orders]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 8);

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-text mb-1">
        {customer?.name ? `Welcome back, ${customer.name}` : "Welcome back"}
      </h1>
      <p className="text-sm text-text-secondary mb-8">
        Here&apos;s an overview of your account.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <SummaryCard
          label="Pending Action"
          count={pendingAction}
          icon={ClipboardList}
          href="/portal/orders"
          color="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
        />
        <SummaryCard
          label="Active Orders"
          count={activeOrders}
          icon={Loader}
          href="/portal/orders"
          color="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        />
        <SummaryCard
          label="Completed"
          count={completed}
          icon={CheckCircle}
          href="/portal/orders"
          color="bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
        />
      </div>

      {/* Recent orders */}
      <h2 className="text-lg font-display font-semibold text-text mb-4">
        Recent Orders
      </h2>
      {recentOrders.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-text-secondary text-sm">No orders yet.</p>
          <Link
            href="/chat"
            className="inline-block mt-3 text-sm text-red-primary hover:text-red-dark font-medium"
          >
            Get your first estimate &rarr;
          </Link>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border">
          {recentOrders.map((order) => {
            const statusConfig = PORTAL_ORDER_STATUS[order.status];
            return (
              <Link
                key={order.id}
                href={`/portal/orders/${order.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-surface-alt transition-colors first:rounded-t-xl last:rounded-b-xl"
              >
                <ClipboardList className="w-4 h-4 text-text-secondary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text truncate">
                    Order #{order.id}
                  </p>
                  <p className="text-xs text-text-secondary capitalize">
                    {statusConfig?.label ?? order.status}
                    {order.subtotalCents > 0
                      ? ` · ${formatCents(order.subtotalCents)}`
                      : ""}
                  </p>
                </div>
                <span className="text-xs text-text-secondary shrink-0">
                  {formatDateTime(order.updatedAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
