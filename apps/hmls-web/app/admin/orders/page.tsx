"use client";

import { ChevronRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAdminOrders } from "@/hooks/useAdmin";
import { formatCents, formatDateTime } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";

/* ── Grouped filters ────────────────────────────────────────────────── */

const FILTER_GROUPS = [
  { value: "", label: "All" },
  { value: "estimated", label: "Estimated" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const MORE_FILTERS = [
  { value: "draft", label: "Draft" },
  { value: "estimated", label: "Estimated" },
  { value: "declined", label: "Declined" },
  { value: "revised", label: "Revised" },
  { value: "invoiced", label: "Invoiced" },
  { value: "paid", label: "Paid" },
  { value: "scheduled", label: "Scheduled" },
  { value: "void", label: "Void" },
  { value: "archived", label: "Archived" },
];

/* ── Page ────────────────────────────────────────────────────────────── */

export default function OrdersPage() {
  const [filter, setFilter] = useState("");
  const [showMore, setShowMore] = useState(false);
  const { orders, isLoading } = useAdminOrders(filter || undefined);

  const isMoreActive = MORE_FILTERS.some((f) => f.value === filter);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-text mb-6">Orders</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {FILTER_GROUPS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFilter(opt.value)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              filter === opt.value
                ? "bg-red-primary text-white"
                : "bg-surface border border-border text-text-secondary hover:text-text hover:border-border-hover"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              isMoreActive
                ? "bg-red-primary text-white"
                : "bg-surface border border-border text-text-secondary hover:text-text hover:border-border-hover"
            }`}
          >
            More {showMore ? "▲" : "▼"}
          </button>
          {showMore && (
            <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-10 py-1 min-w-[140px]">
              {MORE_FILTERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setFilter(opt.value);
                    setShowMore(false);
                  }}
                  className={`w-full text-left text-xs px-3 py-1.5 hover:bg-surface-alt transition-colors ${
                    filter === opt.value
                      ? "text-red-primary font-medium"
                      : "text-text-secondary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          message={filter ? `No ${filter} orders.` : "No orders yet."}
        />
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
                className="flex items-center justify-between gap-3 bg-surface border border-border rounded-xl p-4 hover:border-border-hover transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text">
                      #{order.id}
                    </span>
                    <StatusBadge status={order.status} config={ORDER_STATUS} />
                    {order.revisionNumber > 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                        v{order.revisionNumber}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-text-secondary truncate hidden sm:inline">
                    {order.contactName ?? "Unknown"}
                    {vehicleStr && ` · ${vehicleStr}`}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-text-secondary hidden sm:inline">
                    {formatDateTime(order.createdAt)}
                  </span>
                  {items.length > 0 && (
                    <span className="text-xs font-medium text-text">
                      {formatCents(order.subtotalCents ?? 0)}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-text-secondary group-hover:text-text transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
