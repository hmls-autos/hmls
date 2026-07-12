"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortalCustomer, usePortalOrders } from "@/hooks/usePortal";
import {
  canonicalStatus,
  isBookedOrder,
  isTentativeBooking,
  statusDisplay,
} from "@/lib/status-display";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-2xl font-display font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

export default function PortalDashboard() {
  const { customer, isLoading: customerLoading } = usePortalCustomer();
  const { orders, isLoading: ordersLoading } = usePortalOrders();
  const isLoading = customerLoading || ordersLoading;

  if (isLoading) {
    return (
      <div>
        <Skeleton className="h-8 w-64 mb-1" />
        <Skeleton className="h-4 w-48 mb-8" />
        <Skeleton className="h-20 w-full mb-10 rounded-lg" />
        <Skeleton className="h-6 w-40 mb-4" />
        <div className="space-y-2">
          {["s1", "s2"].map((id) => (
            <Skeleton key={id} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // A customer's only real action is approving/declining a sent estimate.
  const needsAttention = orders.filter(
    (o) => canonicalStatus(o.status) === "estimated",
  );
  const activeOrders = orders.filter((o) => {
    const s = canonicalStatus(o.status);
    return s === "approved" || s === "in_progress";
  }).length;
  const completed = orders.filter((o) => o.status === "completed").length;

  return (
    <div>
      <h1 className="text-2xl font-display font-semibold tracking-tight text-foreground mb-1">
        {customer?.name ? `Welcome back, ${customer.name}` : "Welcome back"}
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        Here&apos;s an overview of your account.
      </p>

      {/* Compact stats strip */}
      <div className="flex items-center gap-12 border-y border-border py-5 mb-10">
        <Stat value={needsAttention.length} label="Pending action" />
        <Stat value={activeOrders} label="Active orders" />
        <Stat value={completed} label="Completed" />
      </div>

      {/* Needs your attention — the estimates waiting on the customer */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider font-mono text-muted-foreground">
          Needs your attention
        </h2>
        <Link
          href="/portal/orders"
          className="text-xs text-primary hover:text-primary/80 font-medium"
        >
          All orders &rarr;
        </Link>
      </div>

      {needsAttention.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          You&apos;re all caught up — nothing needs your attention right now.
        </p>
      ) : (
        <div className="space-y-2">
          {needsAttention.map((order) => (
            <Link
              key={order.id}
              href={`/portal/orders/${order.id}`}
              className="flex items-center justify-between gap-4 bg-muted/40 rounded-lg p-4 hover:bg-muted/60 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-sm font-semibold text-foreground shrink-0">
                  Order #{order.id}
                </span>
                <StatusBadge
                  entry={statusDisplay(order.status, "portal", {
                    tentativeBooking: isTentativeBooking(order),
                    scheduledBooking: isBookedOrder(order),
                  })}
                />
              </div>
              <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                Review estimate
                <ChevronRight className="w-4 h-4" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
