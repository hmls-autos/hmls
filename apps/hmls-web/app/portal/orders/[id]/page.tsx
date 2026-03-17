"use client";

import {
  ArrowLeft,
  Check,
  CreditCard,
  Printer,
  X as XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { usePortalOrder } from "@/hooks/usePortal";
import { authFetch } from "@/lib/fetcher";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import { PORTAL_ORDER_STATUS } from "@/lib/status";
import type { OrderEvent, OrderItem } from "@/lib/types";

/* ── Progress bar ─────────────────────────────────────────────────────── */

const PORTAL_STEPS = [
  "draft",
  "estimated",
  "approved",
  "preauth",
  "scheduled",
  "in_progress",
  "invoiced",
  "paid",
] as const;

const PORTAL_STEP_LABELS: Record<string, string> = {
  draft: "Preparing",
  estimated: "Estimate Ready",
  approved: "Approved",
  preauth: "Card Authorized",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  invoiced: "Invoice Ready",
  paid: "Complete",
};

function getStepState(
  stepStatus: string,
  currentStatus: string,
): "completed" | "current" | "pending" {
  const currentIdx = PORTAL_STEPS.indexOf(
    currentStatus as (typeof PORTAL_STEPS)[number],
  );
  const stepIdx = PORTAL_STEPS.indexOf(
    stepStatus as (typeof PORTAL_STEPS)[number],
  );

  if (currentIdx === -1) {
    if (currentStatus === "declined" || currentStatus === "revised") {
      const effectiveIdx = PORTAL_STEPS.indexOf("estimated");
      return stepIdx <= effectiveIdx ? "completed" : "pending";
    }
    if (currentStatus === "completed" || currentStatus === "archived") {
      return "completed";
    }
    return stepIdx === 0 ? "completed" : "pending";
  }

  if (stepIdx < currentIdx) return "completed";
  if (stepIdx === currentIdx) return "current";
  return "pending";
}

function PortalProgressBar({ status }: { status: string }) {
  const isTerminal = new Set(["cancelled", "void", "archived"]).has(status);
  const isBranch = new Set(["declined", "revised"]).has(status);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-0 overflow-x-auto pb-1">
        {PORTAL_STEPS.map((step, idx) => {
          const state = getStepState(step, status);
          return (
            <div key={step} className="flex items-center">
              {idx > 0 && (
                <div
                  className={`h-0.5 w-3 sm:w-6 shrink-0 ${
                    state === "completed" || state === "current"
                      ? "bg-emerald-500"
                      : "bg-border"
                  }`}
                />
              )}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                    state === "completed"
                      ? "bg-emerald-500 text-white"
                      : state === "current"
                        ? "bg-red-primary text-white ring-2 ring-red-primary/30"
                        : "bg-surface border-2 border-border text-text-secondary"
                  }`}
                >
                  {state === "completed" ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <span className="text-[10px]">{idx + 1}</span>
                  )}
                </div>
                <span
                  className={`text-[10px] leading-tight text-center whitespace-nowrap ${
                    state === "current"
                      ? "font-semibold text-text"
                      : state === "completed"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-text-secondary"
                  }`}
                >
                  {PORTAL_STEP_LABELS[step]}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {(isTerminal || isBranch) && (
        <div className="flex items-center gap-2">
          <StatusBadge status={status} config={PORTAL_ORDER_STATUS} />
          {status === "declined" && (
            <span className="text-xs text-text-secondary">
              Estimate declined — we may send a revised version soon
            </span>
          )}
          {status === "revised" && (
            <span className="text-xs text-text-secondary">
              Updated estimate ready for your review
            </span>
          )}
          {status === "cancelled" && (
            <span className="text-xs text-text-secondary">
              Order was cancelled
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Timeline helpers ─────────────────────────────────────────────────── */

function eventDescription(event: OrderEvent): string {
  switch (event.eventType) {
    case "status_change":
      if (event.toStatus) {
        const label =
          PORTAL_ORDER_STATUS[event.toStatus]?.label ?? event.toStatus;
        return `Status updated to: ${label}`;
      }
      return "Status updated";
    case "items_edited":
      return "Service items were updated";
    case "contact_edited":
      return "Contact information updated";
    default:
      return event.eventType.replace(/_/g, " ");
  }
}

function StatusTimeline({ events }: { events: OrderEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-text-secondary py-2">No activity yet.</p>;
  }
  return (
    <div className="space-y-0">
      {events.map((event, idx) => (
        <div key={event.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-2 h-2 rounded-full bg-text-secondary mt-1.5 shrink-0" />
            {idx < events.length - 1 && (
              <div className="w-px flex-1 bg-border mt-1 mb-1" />
            )}
          </div>
          <div className="pb-3 min-w-0 flex-1">
            <p className="text-xs text-text leading-snug">
              {eventDescription(event)}
            </p>
            <span className="text-[10px] text-text-secondary">
              {formatDateTime(event.createdAt)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Print receipt ────────────────────────────────────────────────────── */

function PrintReceipt({
  order,
}: {
  order: {
    id: number;
    status: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
    vehicleInfo: { year?: number; make?: string; model?: string } | null;
    items: OrderItem[];
    subtotalCents: number;
    priceRangeLowCents: number | null;
    priceRangeHighCents: number | null;
    notes: string | null;
    createdAt: string;
  };
}) {
  const vehicle = order.vehicleInfo;
  const vehicleStr = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")
    : null;
  const statusLabel = PORTAL_ORDER_STATUS[order.status]?.label ?? order.status;

  return (
    <div className="hidden print:block text-black bg-white p-8 max-w-2xl mx-auto font-sans">
      {/* Header */}
      <div className="flex justify-between items-start mb-6 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">HMLS</h1>
          <p className="text-sm text-gray-500">Mobile Mechanic Service</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">Order #{order.id}</p>
          <p className="text-gray-500">{formatDate(order.createdAt)}</p>
          <p className="text-gray-500">{statusLabel}</p>
        </div>
      </div>

      {/* Contact + Vehicle */}
      <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
        <div>
          <p className="font-semibold text-gray-700 mb-1">Customer</p>
          {order.contactName && <p>{order.contactName}</p>}
          {order.contactEmail && (
            <p className="text-gray-600">{order.contactEmail}</p>
          )}
          {order.contactPhone && (
            <p className="text-gray-600">{order.contactPhone}</p>
          )}
          {order.contactAddress && (
            <p className="text-gray-600">{order.contactAddress}</p>
          )}
        </div>
        {vehicleStr && (
          <div>
            <p className="font-semibold text-gray-700 mb-1">Vehicle</p>
            <p>{vehicleStr}</p>
          </div>
        )}
      </div>

      {/* Line items */}
      {order.items.length > 0 && (
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-1.5 font-semibold text-gray-700">
                Service
              </th>
              <th className="text-right py-1.5 font-semibold text-gray-700 w-12">
                Qty
              </th>
              <th className="text-right py-1.5 font-semibold text-gray-700 w-24">
                Unit
              </th>
              <th className="text-right py-1.5 font-semibold text-gray-700 w-24">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="py-1.5">
                  <span className="text-xs uppercase text-gray-400 mr-2">
                    {item.category}
                  </span>
                  {item.name}
                  {item.description && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.description}
                    </p>
                  )}
                </td>
                <td className="py-1.5 text-right text-gray-600">
                  {item.quantity}
                </td>
                <td className="py-1.5 text-right text-gray-600">
                  {formatCents(item.unitPriceCents)}
                </td>
                <td className="py-1.5 text-right font-medium">
                  {formatCents(item.totalCents)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300">
              <td colSpan={3} className="py-2 text-right font-semibold">
                Subtotal
              </td>
              <td className="py-2 text-right font-bold text-lg">
                {formatCents(order.subtotalCents)}
              </td>
            </tr>
            {(order.priceRangeLowCents != null ||
              order.priceRangeHighCents != null) && (
              <tr>
                <td
                  colSpan={3}
                  className="text-right text-xs text-gray-500 pb-1"
                >
                  Estimated range
                </td>
                <td className="text-right text-xs text-gray-500 pb-1">
                  {order.priceRangeLowCents != null
                    ? formatCents(order.priceRangeLowCents)
                    : "—"}{" "}
                  –{" "}
                  {order.priceRangeHighCents != null
                    ? formatCents(order.priceRangeHighCents)
                    : "—"}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      )}

      {order.notes && (
        <p className="text-xs text-gray-500 italic mb-4">{order.notes}</p>
      )}

      <p className="text-xs text-gray-400 text-center pt-4 border-t border-gray-100">
        Thank you for choosing HMLS Mobile Mechanic · hmls.autos
      </p>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function PortalOrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;
  const { data, isLoading, isError, mutate } = usePortalOrder(orderId);
  const [actionLoading, setActionLoading] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (isError || !data?.order) {
    return (
      <div className="text-center py-20">
        <p className="text-text-secondary">Order not found.</p>
        <Link
          href="/portal/orders"
          className="text-red-primary text-sm hover:underline mt-2 inline-block"
        >
          Back to orders
        </Link>
      </div>
    );
  }

  const { order, events } = data;
  const items: OrderItem[] = order.items ?? [];
  const vehicle = order.vehicleInfo;
  const vehicleStr = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")
    : null;
  const canApproveDecline = order.status === "estimated";
  const canPreauth = order.status === "approved";

  async function handleAction(action: "approve" | "decline") {
    if (action === "decline") {
      const reason = prompt("Reason for declining (optional):");
      if (reason === null) return;
      await doAction(action, reason || undefined);
    } else {
      await doAction(action);
    }
  }

  async function doAction(action: "approve" | "decline", reason?: string) {
    setActionLoading(true);
    try {
      await authFetch(`/api/portal/me/orders/${order.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to ${action} order`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePreauth() {
    setActionLoading(true);
    try {
      await authFetch(`/api/portal/me/orders/${order.id}/preauth`, {
        method: "POST",
      });
      mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to authorize card");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <>
      {/* Print receipt — only visible when printing */}
      <PrintReceipt order={{ ...order, items }} />

      {/* Screen content — hidden when printing */}
      <div className="space-y-6 print:hidden">
        {/* Breadcrumb */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/portal/orders"
              className="flex items-center gap-1 text-xs text-text-secondary hover:text-text transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              My Orders
            </Link>
            <span className="text-xs text-text-secondary">/</span>
            <span className="text-xs text-text font-medium">#{order.id}</span>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text transition-colors border border-border rounded-lg px-3 py-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>

        {/* Title row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-display font-bold text-text">
              Order #{order.id}
            </h1>
            <StatusBadge status={order.status} config={PORTAL_ORDER_STATUS} />
          </div>
          <span className="text-xs text-text-secondary">
            Created {formatDateTime(order.createdAt)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <PortalProgressBar status={order.status} />
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Contact info */}
            <div className="bg-surface border border-border rounded-xl p-4">
              <h2 className="text-sm font-semibold text-text mb-3">Contact</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-text-secondary">Name</span>
                  <p className="text-text font-medium">
                    {order.contactName ?? "—"}
                  </p>
                </div>
                <div>
                  <span className="text-text-secondary">Email</span>
                  <p className="text-text font-medium">
                    {order.contactEmail ?? "—"}
                  </p>
                </div>
                <div>
                  <span className="text-text-secondary">Phone</span>
                  <p className="text-text font-medium">
                    {order.contactPhone ?? "—"}
                  </p>
                </div>
                <div>
                  <span className="text-text-secondary">Address</span>
                  <p className="text-text font-medium">
                    {order.contactAddress ?? "—"}
                  </p>
                </div>
              </div>
            </div>

            {/* Vehicle */}
            {vehicleStr && (
              <div className="bg-surface border border-border rounded-xl p-4">
                <h2 className="text-sm font-semibold text-text mb-2">
                  Vehicle
                </h2>
                <p className="text-sm text-text">{vehicleStr}</p>
              </div>
            )}

            {/* Line items */}
            <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold text-text">Services</h2>
              {items.length > 0 ? (
                <>
                  <div className="border border-border rounded-lg overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-surface-alt text-text-secondary">
                          <th className="text-left px-3 py-1.5 font-medium">
                            Item
                          </th>
                          <th className="text-right px-3 py-1.5 font-medium">
                            Qty
                          </th>
                          <th className="text-right px-3 py-1.5 font-medium">
                            Price
                          </th>
                          <th className="text-right px-3 py-1.5 font-medium">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id} className="border-t border-border">
                            <td className="px-3 py-1.5 text-text">
                              <span className="text-[10px] uppercase text-text-secondary mr-1.5">
                                {item.category}
                              </span>
                              {item.name}
                              {item.description && (
                                <p className="text-[10px] text-text-secondary mt-0.5">
                                  {item.description}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right text-text">
                              {item.quantity}
                            </td>
                            <td className="px-3 py-1.5 text-right text-text">
                              {formatCents(item.unitPriceCents)}
                            </td>
                            <td className="px-3 py-1.5 text-right text-text font-medium">
                              {formatCents(item.totalCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border bg-surface-alt">
                          <td
                            colSpan={3}
                            className="px-3 py-1.5 text-right font-medium text-text"
                          >
                            Subtotal
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold text-text">
                            {formatCents(order.subtotalCents ?? 0)}
                          </td>
                        </tr>
                        {(order.priceRangeLowCents != null ||
                          order.priceRangeHighCents != null) && (
                          <tr className="border-t border-border">
                            <td
                              colSpan={3}
                              className="px-3 py-1 text-right text-xs text-text-secondary"
                            >
                              Estimated range
                            </td>
                            <td className="px-3 py-1 text-right text-xs text-text-secondary">
                              {order.priceRangeLowCents != null
                                ? formatCents(order.priceRangeLowCents)
                                : "—"}{" "}
                              –{" "}
                              {order.priceRangeHighCents != null
                                ? formatCents(order.priceRangeHighCents)
                                : "—"}
                            </td>
                          </tr>
                        )}
                      </tfoot>
                    </table>
                  </div>
                  {order.notes && (
                    <p className="text-xs text-text-secondary italic">
                      {order.notes}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-text-secondary">
                  No service items yet — your estimate is being prepared.
                </p>
              )}
            </div>

            {/* Cancellation reason */}
            {order.cancellationReason && (
              <div className="bg-surface border border-red-200 dark:border-red-900/50 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">
                  Cancellation Reason
                </h2>
                <p className="text-xs text-text">{order.cancellationReason}</p>
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {/* Action buttons */}
            {canApproveDecline && (
              <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
                <h2 className="text-sm font-semibold text-text">
                  Your Action Required
                </h2>
                <p className="text-xs text-text-secondary">
                  Please review the services above and approve or decline this
                  estimate.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => handleAction("approve")}
                    disabled={actionLoading}
                    className="flex items-center justify-center gap-1.5 text-xs font-medium px-4 py-2.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve Estimate
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAction("decline")}
                    disabled={actionLoading}
                    className="flex items-center justify-center gap-1.5 text-xs font-medium px-4 py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                    Decline
                  </button>
                </div>
              </div>
            )}

            {canPreauth && (
              <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
                <h2 className="text-sm font-semibold text-text">
                  Authorize Payment
                </h2>
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-purple-500" />
                  <span className="text-sm font-medium text-text">
                    Card Authorization Required
                  </span>
                </div>
                <p className="text-xs text-text-secondary">
                  A hold of{" "}
                  <span className="font-semibold text-text">
                    {formatCents(Math.ceil(order.subtotalCents * 1.15))}
                  </span>{" "}
                  will be placed on your card (estimate + 15% buffer). You will
                  only be charged the final amount after service is complete.
                </p>
                <button
                  type="button"
                  onClick={handlePreauth}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-medium px-4 py-2.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  {actionLoading ? "Processing..." : "Authorize Card"}
                </button>
              </div>
            )}

            {order.status === "preauth" && (
              <div className="bg-surface border border-purple-200 dark:border-purple-900/50 rounded-xl p-4">
                <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                  <Check className="w-4 h-4" />
                  <span className="text-xs font-medium">
                    Card authorized — your appointment will be scheduled soon
                  </span>
                </div>
              </div>
            )}

            {/* Order details */}
            <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
              <h2 className="text-sm font-semibold text-text">Details</h2>
              <div className="text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Order ID</span>
                  <span className="text-text font-mono">#{order.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Status</span>
                  <span className="text-text">
                    {PORTAL_ORDER_STATUS[order.status]?.label ?? order.status}
                  </span>
                </div>
                {order.expiresAt && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">
                      Estimate expires
                    </span>
                    <span className="text-text">
                      {formatDate(order.expiresAt)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-text-secondary">Updated</span>
                  <span className="text-text">
                    {formatDateTime(order.updatedAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* Linked records */}
            {(order.estimateId || order.quoteId || order.bookingId) && (
              <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
                <h2 className="text-sm font-semibold text-text">Linked</h2>
                <div className="flex flex-wrap gap-2">
                  {order.estimateId && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                      Estimate #{order.estimateId}
                    </span>
                  )}
                  {order.quoteId && (
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                      Quote #{order.quoteId}
                    </span>
                  )}
                  {order.bookingId && (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                      Booking #{order.bookingId}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Activity timeline */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-text mb-3">
            Order History
          </h2>
          <StatusTimeline events={events ?? []} />
        </div>
      </div>
    </>
  );
}
