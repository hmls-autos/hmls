"use client";

import { ChevronRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminDashboard, useAdminOrders } from "@/hooks/useAdmin";
import { formatCents, formatDateTime } from "@/lib/format";
import { ORDER_STATUS, type StatusConfig } from "@/lib/status";
import { cn } from "@/lib/utils";

/* ── Helpers ──────────────────────────────────────────────────────────── */

function OrderStatusBadge({
  status,
  config,
}: {
  status: string;
  config: Record<string, StatusConfig>;
}) {
  const entry = config[status] ?? {
    label: status,
    color: "bg-neutral-100 text-neutral-500",
  };
  return (
    <Badge variant="outline" className={cn(entry.color)}>
      {entry.label}
    </Badge>
  );
}

/* ── Grouped filters ────────────────────────────────────────────────── */

const FILTER_GROUPS = [
  { value: "", label: "All" },
  { value: "draft", label: "Pending Review" },
  { value: "estimated", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

const MORE_FILTERS = [
  { value: "declined", label: "Declined" },
  { value: "revised", label: "Revised" },
  { value: "cancelled", label: "Cancelled" },
];

/* ── Skeleton loading state ───────────────────────────────────────────── */

function OrdersSkeleton() {
  return (
    <div className="space-y-2">
      {["sk-1", "sk-2", "sk-3", "sk-4", "sk-5"].map((id) => (
        <Skeleton key={id} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function OrdersPage() {
  const [filter, setFilter] = useState("");
  const [showMore, setShowMore] = useState(false);
  const { orders, isLoading } = useAdminOrders(filter || undefined);
  const { data: dashboard } = useAdminDashboard();
  const pendingReviewCount = dashboard?.stats.pendingReview ?? 0;

  const isMoreActive = MORE_FILTERS.some((f) => f.value === filter);

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-foreground mb-6">
        Orders
      </h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {FILTER_GROUPS.map((opt) => {
          const showCount = opt.value === "draft" && pendingReviewCount > 0;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilter(opt.value)}
              className={cn(
                "text-xs font-medium px-3 py-1.5 rounded-full transition-colors inline-flex items-center gap-1.5",
                filter === opt.value
                  ? "bg-primary text-white"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary",
              )}
            >
              {opt.label}
              {showCount && (
                <span
                  className={cn(
                    "rounded-full text-[10px] leading-none px-1.5 py-0.5 font-semibold",
                    filter === opt.value
                      ? "bg-white text-primary"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                  )}
                >
                  {pendingReviewCount}
                </span>
              )}
            </button>
          );
        })}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className={cn(
              "text-xs font-medium px-3 py-1.5 rounded-full transition-colors",
              isMoreActive
                ? "bg-primary text-white"
                : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary",
            )}
          >
            More {showMore ? "\u25B2" : "\u25BC"}
          </button>
          {showMore && (
            <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 py-1 min-w-[140px]">
              {MORE_FILTERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setFilter(opt.value);
                    setShowMore(false);
                  }}
                  className={cn(
                    "w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors",
                    filter === opt.value
                      ? "text-primary font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <OrdersSkeleton />
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ClipboardList className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {filter ? `No ${filter} orders.` : "No orders yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => {
            const vehicle = order.vehicleInfo;
            const vehicleStr = vehicle
              ? [vehicle.year, vehicle.make, vehicle.model]
                  .filter(Boolean)
                  .join(" ")
              : null;
            const items = order.items ?? [];

            return (
              <Link
                key={order.id}
                href={`/admin/orders/${order.id}`}
                className="flex items-center justify-between gap-3 bg-card border border-border rounded-xl p-4 hover:border-primary transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      #{order.id}
                    </span>
                    <OrderStatusBadge
                      status={order.status}
                      config={ORDER_STATUS}
                    />
                    {order.revisionNumber > 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                        v{order.revisionNumber}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                    {order.contactName ?? "Unknown"}
                    {vehicleStr && ` \u00B7 ${vehicleStr}`}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {formatDateTime(order.createdAt)}
                  </span>
                  {items.length > 0 && (
                    <span className="text-xs font-medium text-foreground">
                      {formatCents(order.subtotalCents ?? 0)}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
