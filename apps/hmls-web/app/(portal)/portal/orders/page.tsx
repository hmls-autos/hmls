"use client";

import { Check, ClipboardList, CreditCard, X as XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { type PortalOrder, usePortalOrders } from "@/hooks/usePortal";
import { authFetch } from "@/lib/fetcher";
import { formatCents, formatDateTime } from "@/lib/format";
import { PORTAL_ORDER_STATUS } from "@/lib/status";

function OrderCard({
  order,
  onAction,
  onPreauth,
  loading,
}: {
  order: PortalOrder;
  onAction: (orderId: number, action: "approve" | "decline") => void;
  onPreauth: (orderId: number) => void;
  loading: number | null;
}) {
  const canApproveDecline = order.status === "estimated";
  const canPreauth = order.status === "approved";

  return (
    <div className="bg-surface border border-border rounded-xl p-5 hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href={`/portal/orders/${order.id}`}
              className="text-sm font-semibold text-text hover:text-red-primary transition-colors"
            >
              Order #{order.id}
            </Link>
            <StatusBadge status={order.status} config={PORTAL_ORDER_STATUS} />
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            {formatDateTime(order.createdAt)}
          </p>
        </div>
        <Link
          href={`/portal/orders/${order.id}`}
          className="text-xs text-text-secondary hover:text-text transition-colors shrink-0"
        >
          View →
        </Link>
      </div>

      {/* Linked entities */}
      <div className="flex flex-wrap gap-2 mb-3">
        {order.estimateId && (
          <Link
            href="/portal/estimates"
            className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 hover:underline"
          >
            Estimate #{order.estimateId}
          </Link>
        )}
        {order.quoteId && (
          <Link
            href="/portal/quotes"
            className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 hover:underline"
          >
            Quote #{order.quoteId}
          </Link>
        )}
        {order.bookingId && (
          <Link
            href="/portal/bookings"
            className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 hover:underline"
          >
            Booking #{order.bookingId}
          </Link>
        )}
      </div>

      {order.cancellationReason && (
        <p className="text-xs text-red-500 mb-3">
          Reason: {order.cancellationReason}
        </p>
      )}

      {/* Status timeline */}
      {Array.isArray(order.statusHistory) && order.statusHistory.length > 0 && (
        <div className="border-t border-border pt-3 mb-3">
          <p className="text-xs font-medium text-text-secondary mb-2">
            History
          </p>
          <div className="space-y-1">
            {order.statusHistory.map((entry) => (
              <div
                key={`${entry.status}-${entry.timestamp}`}
                className="flex items-center gap-2 text-xs text-text-secondary"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0" />
                <span>
                  {PORTAL_ORDER_STATUS[entry.status]?.label ?? entry.status}
                </span>
                <span className="text-text-secondary/60">
                  {new Date(entry.timestamp).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approve / Decline buttons */}
      {canApproveDecline && (
        <div className="flex gap-2 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => onAction(order.id, "approve")}
            disabled={loading === order.id}
            className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            Approve Estimate
          </button>
          <button
            type="button"
            onClick={() => onAction(order.id, "decline")}
            disabled={loading === order.id}
            className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
          >
            <XIcon className="w-3.5 h-3.5" />
            Decline
          </button>
        </div>
      )}

      {/* Pre-auth payment section */}
      {canPreauth && (
        <div className="pt-3 border-t border-border space-y-2">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium text-text">
              Authorize Payment
            </span>
          </div>
          <p className="text-xs text-text-secondary">
            A hold of{" "}
            <span className="font-semibold text-text">
              {formatCents(Math.ceil(order.subtotalCents * 1.15))}
            </span>{" "}
            will be placed on your card (estimate + 15% buffer). You will only
            be charged the final amount after service is complete.
          </p>
          <button
            type="button"
            onClick={() => onPreauth(order.id)}
            disabled={loading === order.id}
            className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            <CreditCard className="w-3.5 h-3.5" />
            {loading === order.id ? "Processing..." : "Authorize Card"}
          </button>
        </div>
      )}

      {/* Preauth confirmed message */}
      {order.status === "preauth" && (
        <div className="pt-3 border-t border-border">
          <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
            <Check className="w-4 h-4" />
            <span className="text-xs font-medium">
              Card authorized — waiting for appointment scheduling
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortalOrdersPage() {
  const { orders, isLoading, mutate } = usePortalOrders();
  const [loading, setLoading] = useState<number | null>(null);

  async function handlePreauth(orderId: number) {
    setLoading(orderId);
    try {
      await authFetch(`/api/portal/me/orders/${orderId}/preauth`, {
        method: "POST",
      });
      mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to authorize card");
    } finally {
      setLoading(null);
    }
  }

  async function handleAction(orderId: number, action: "approve" | "decline") {
    if (action === "decline") {
      const reason = prompt("Reason for declining (optional):");
      if (reason === null) return;
      await doAction(orderId, action, reason || undefined);
    } else {
      await doAction(orderId, action);
    }
  }

  async function doAction(
    orderId: number,
    action: "approve" | "decline",
    reason?: string,
  ) {
    setLoading(orderId);
    try {
      await authFetch(`/api/portal/me/orders/${orderId}/${action}`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to ${action} order`);
    } finally {
      setLoading(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="My Orders"
        subtitle="Track your service orders from estimate to completion."
      />

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          message="No orders yet. Start a chat to get an estimate!"
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onAction={handleAction}
              onPreauth={handlePreauth}
              loading={loading}
            />
          ))}
        </div>
      )}
    </div>
  );
}
