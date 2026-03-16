"use client";

import {
  ArrowLeft,
  Calendar,
  Check,
  ClipboardEdit,
  ExternalLink,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  Tag,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAdminOrder } from "@/hooks/useAdmin";
import { AGENT_URL } from "@/lib/config";
import { authFetch } from "@/lib/fetcher";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import {
  EDITABLE_STATUSES,
  ORDER_STATUS,
  ORDER_TRANSITIONS,
} from "@/lib/status";
import type { OrderEvent, OrderItem } from "@/lib/types";

/* ── Constants ────────────────────────────────────────────────────────── */

const TRANSITION_LABELS: Record<string, string> = {
  sent: "Send",
  approved: "Approve",
  declined: "Decline",
  revised: "Revise",
  preauth: "Pre-Auth",
  invoiced: "Invoice",
  paid: "Mark Paid",
  void: "Void",
  scheduled: "Schedule",
  in_progress: "Start",
  completed: "Complete",
  archived: "Archive",
  cancelled: "Cancel",
};

const DANGER_ACTIONS = new Set(["cancelled", "void", "declined"]);

const ESTIMATE_STATUSES = new Set(["draft", "revised"]);
const QUOTE_STATUSES = new Set(["sent", "approved", "preauth", "invoiced"]);
const BOOKING_STATUSES = new Set([
  "paid",
  "scheduled",
  "in_progress",
  "completed",
]);

/* ── Progress bar steps ───────────────────────────────────────────────── */

const MAIN_STEPS = [
  "draft",
  "sent",
  "approved",
  "preauth",
  "scheduled",
  "in_progress",
  "invoiced",
  "paid",
] as const;

const MAIN_STEP_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  preauth: "Card on File",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  invoiced: "Invoiced",
  paid: "Paid",
};

const TERMINAL_STATUSES = new Set(["cancelled", "void", "archived"]);
const BRANCH_STATUSES = new Set(["declined", "revised"]);

function getStepState(
  stepStatus: string,
  currentStatus: string,
): "completed" | "current" | "pending" {
  const currentIdx = MAIN_STEPS.indexOf(
    currentStatus as (typeof MAIN_STEPS)[number],
  );
  const stepIdx = MAIN_STEPS.indexOf(stepStatus as (typeof MAIN_STEPS)[number]);

  // If current status is a branch/terminal, figure out progress from statusHistory context
  if (currentIdx === -1) {
    // declined/revised sit between sent and approved
    if (currentStatus === "declined" || currentStatus === "revised") {
      const effectiveIdx = MAIN_STEPS.indexOf("sent");
      if (stepIdx <= effectiveIdx) return "completed";
      return "pending";
    }
    // terminal: cancelled/void/archived — mark all up to last main step as completed
    if (currentStatus === "archived") {
      // archived means completed was reached
      return "completed";
    }
    // cancelled/void — we don't know exactly where, treat nothing as current
    return stepIdx === 0 ? "completed" : "pending";
  }

  if (stepIdx < currentIdx) return "completed";
  if (stepIdx === currentIdx) return "current";
  return "pending";
}

/* ── Progress Bar ─────────────────────────────────────────────────────── */

function OrderProgressBar({ status }: { status: string }) {
  const isTerminal = TERMINAL_STATUSES.has(status);
  const isBranch = BRANCH_STATUSES.has(status);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {MAIN_STEPS.map((step, idx) => {
          const state = getStepState(step, status);
          return (
            <div key={step} className="flex items-center">
              {/* Connector line before (except first) */}
              {idx > 0 && (
                <div
                  className={`h-0.5 w-4 sm:w-8 shrink-0 ${
                    state === "completed" || state === "current"
                      ? "bg-emerald-500"
                      : "bg-border"
                  }`}
                />
              )}
              {/* Step circle + label */}
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
                  {MAIN_STEP_LABELS[step]}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Branch/terminal badge */}
      {(isTerminal || isBranch) && (
        <div className="flex items-center gap-2">
          <StatusBadge status={status} config={ORDER_STATUS} />
          {isBranch && (
            <span className="text-xs text-text-secondary">
              {status === "declined"
                ? "Customer declined — revise or cancel"
                : "Revised estimate ready to re-send"}
            </span>
          )}
          {status === "cancelled" && (
            <span className="text-xs text-text-secondary">
              Order was cancelled
            </span>
          )}
          {status === "void" && (
            <span className="text-xs text-text-secondary">
              Invoice was voided
            </span>
          )}
          {status === "archived" && (
            <span className="text-xs text-text-secondary">
              Order archived after completion
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Customer Editor ──────────────────────────────────────────────────── */

function CustomerEditor({
  order,
  onSave,
  onCancel,
  saving,
}: {
  order: {
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
  };
  onSave: (data: {
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    contact_address: string;
  }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(order.contactName ?? "");
  const [email, setEmail] = useState(order.contactEmail ?? "");
  const [phone, setPhone] = useState(order.contactPhone ?? "");
  const [address, setAddress] = useState(order.contactAddress ?? "");

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-alt space-y-3">
      <h4 className="text-xs font-semibold text-text uppercase tracking-wide">
        Edit Contact (this order only)
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-xs bg-surface border border-border rounded px-2 py-1.5 text-text"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="text-xs bg-surface border border-border rounded px-2 py-1.5 text-text"
        />
        <input
          type="tel"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="text-xs bg-surface border border-border rounded px-2 py-1.5 text-text"
        />
      </div>
      <textarea
        placeholder="Address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        rows={2}
        className="w-full text-xs bg-surface border border-border rounded px-2 py-1.5 text-text resize-y"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-xs font-medium px-3 py-1.5 rounded-lg text-text-secondary hover:text-text hover:bg-surface transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            onSave({
              contact_name: name,
              contact_email: email,
              contact_phone: phone,
              contact_address: address,
            })
          }
          disabled={saving}
          className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-primary text-white hover:bg-red-primary/90 transition-colors disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

/* ── Item Editor ──────────────────────────────────────────────────────── */

function ItemEditor({
  items,
  notes,
  onSave,
  onCancel,
  saving,
}: {
  items: OrderItem[];
  notes: string | null;
  onSave: (items: OrderItem[], notes: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [editItems, setEditItems] = useState<OrderItem[]>(
    items.length > 0 ? items : [],
  );
  const [editNotes, setEditNotes] = useState(notes ?? "");

  function updateItem(index: number, patch: Partial<OrderItem>) {
    setEditItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, ...patch };
        if ("quantity" in patch || "unitPriceCents" in patch) {
          updated.totalCents = updated.quantity * updated.unitPriceCents;
        }
        return updated;
      }),
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-alt space-y-3">
      <h4 className="text-xs font-semibold text-text uppercase tracking-wide">
        Edit Items
      </h4>

      {editItems.map((item, idx) => (
        <div
          key={item.id}
          className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-2 border-b border-border pb-2 last:border-0"
        >
          <select
            value={item.category}
            onChange={(e) =>
              updateItem(idx, {
                category: e.target.value as OrderItem["category"],
              })
            }
            className="text-xs bg-surface border border-border rounded px-2 py-1.5"
          >
            <option value="labor">Labor</option>
            <option value="parts">Parts</option>
            <option value="fee">Fee</option>
            <option value="discount">Discount</option>
          </select>
          <input
            type="text"
            placeholder="Name"
            value={item.name}
            onChange={(e) => updateItem(idx, { name: e.target.value })}
            className="min-w-0 text-xs bg-surface border border-border rounded px-2 py-1.5 text-text"
          />
          <input
            type="number"
            min={1}
            value={item.quantity}
            onChange={(e) =>
              updateItem(idx, { quantity: Number(e.target.value) || 1 })
            }
            className="w-full sm:w-14 text-xs bg-surface border border-border rounded px-2 py-1.5 text-text text-right"
          />
          <input
            type="number"
            min={0}
            step={1}
            placeholder="¢"
            value={item.unitPriceCents}
            onChange={(e) =>
              updateItem(idx, {
                unitPriceCents: Number(e.target.value) || 0,
              })
            }
            className="w-full sm:w-24 text-xs bg-surface border border-border rounded px-2 py-1.5 text-text text-right"
          />
          <span className="text-xs text-text-secondary w-16 text-right">
            {formatCents(item.quantity * item.unitPriceCents)}
          </span>
          <button
            type="button"
            onClick={() =>
              setEditItems((prev) => prev.filter((_, i) => i !== idx))
            }
            className="text-red-500 hover:text-red-700 p-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          setEditItems((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              category: "labor",
              name: "",
              description: "",
              quantity: 1,
              unitPriceCents: 0,
              totalCents: 0,
              taxable: true,
            },
          ])
        }
        className="flex items-center gap-1 text-xs text-text-secondary hover:text-text"
      >
        <Plus className="w-3.5 h-3.5" /> Add item
      </button>

      <div>
        <label className="text-xs font-medium text-text-secondary block mb-1">
          Notes
          <textarea
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            rows={2}
            className="w-full text-xs bg-surface border border-border rounded px-2 py-1.5 text-text resize-y"
          />
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-xs font-medium px-3 py-1.5 rounded-lg text-text-secondary hover:text-text hover:bg-surface transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(editItems, editNotes)}
          disabled={saving}
          className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-primary text-white hover:bg-red-primary/90 transition-colors disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

/* ── Estimate Panel ───────────────────────────────────────────────────── */

function EstimatePanel({
  order,
}: {
  order: {
    shareToken: string | null;
    id: number;
    vehicleInfo: { year?: number; make?: string; model?: string } | null;
    priceRangeLowCents: number | null;
    priceRangeHighCents: number | null;
    expiresAt: string | null;
  };
}) {
  const vehicle = order.vehicleInfo;
  return (
    <div className="rounded-lg border border-border bg-surface-alt p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text uppercase tracking-wide">
          Estimate
        </span>
        {order.shareToken && (
          <a
            href={`${AGENT_URL}/api/orders/${order.id}/pdf?token=${order.shareToken}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text"
            title="View PDF"
          >
            <ExternalLink className="w-3 h-3" /> PDF
          </a>
        )}
      </div>
      {vehicle && (
        <p className="text-xs text-text-secondary">
          {[vehicle.year, vehicle.make, vehicle.model]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
      {(order.priceRangeLowCents != null ||
        order.priceRangeHighCents != null) && (
        <p className="text-xs text-text">
          Range:{" "}
          <span className="font-medium">
            {order.priceRangeLowCents != null
              ? formatCents(order.priceRangeLowCents)
              : "—"}
            {" – "}
            {order.priceRangeHighCents != null
              ? formatCents(order.priceRangeHighCents)
              : "—"}
          </span>
        </p>
      )}
      {order.expiresAt && (
        <p className="text-xs text-text-secondary">
          Expires {formatDate(order.expiresAt)}
        </p>
      )}
    </div>
  );
}

/* ── Quote Panel ──────────────────────────────────────────────────────── */

function QuotePanel({
  order,
}: {
  order: {
    subtotalCents: number;
    stripeQuoteId: string | null;
    stripeInvoiceId: string | null;
    quoteId: number | null;
  };
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-alt p-3 space-y-2">
      <span className="text-xs font-semibold text-text uppercase tracking-wide block">
        Quote
      </span>
      <p className="text-xs text-text">
        Total:{" "}
        <span className="font-semibold">
          {formatCents(order.subtotalCents ?? 0)}
        </span>
      </p>
      {order.stripeQuoteId && (
        <p className="text-xs text-text-secondary">
          Stripe Quote: <span className="font-mono">{order.stripeQuoteId}</span>
        </p>
      )}
      {order.stripeInvoiceId && (
        <p className="text-xs text-text-secondary">
          Invoice: <span className="font-mono">{order.stripeInvoiceId}</span>
        </p>
      )}
      {order.quoteId && (
        <p className="text-xs text-text-secondary">
          Quote ID: #{order.quoteId}
        </p>
      )}
    </div>
  );
}

/* ── Booking Panel ────────────────────────────────────────────────────── */

function BookingPanel({
  order,
}: {
  order: {
    vehicleInfo: { year?: number; make?: string; model?: string } | null;
    bookingId: number | null;
    adminNotes: string | null;
  };
}) {
  const vehicle = order.vehicleInfo;
  return (
    <div className="rounded-lg border border-border bg-surface-alt p-3 space-y-2">
      <span className="text-xs font-semibold text-text uppercase tracking-wide block">
        Booking
      </span>
      {vehicle && (
        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
          <MapPin className="w-3 h-3" />
          {[vehicle.year, vehicle.make, vehicle.model]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
      {order.bookingId && (
        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Calendar className="w-3 h-3" />
          Booking #{order.bookingId}
        </p>
      )}
      {order.adminNotes && (
        <p className="text-xs text-text-secondary border-t border-border pt-2">
          <span className="font-medium text-text">Admin notes:</span>{" "}
          {order.adminNotes}
        </p>
      )}
    </div>
  );
}

/* ── Activity Timeline ────────────────────────────────────────────────── */

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function eventDescription(event: OrderEvent): string {
  switch (event.eventType) {
    case "status_change":
      if (event.fromStatus && event.toStatus) {
        const fromLabel =
          MAIN_STEP_LABELS[event.fromStatus] ?? event.fromStatus;
        const toLabel = MAIN_STEP_LABELS[event.toStatus] ?? event.toStatus;
        return `Status changed from ${fromLabel} → ${toLabel}`;
      }
      return "Status changed";
    case "items_edited":
      return "Line items updated";
    case "contact_edited":
      return "Contact info updated";
    case "note_added": {
      const note = (event.metadata as { note?: string })?.note;
      return note ? `Note: ${note}` : "Note added";
    }
    default:
      return event.eventType.replace(/_/g, " ");
  }
}

function EventIcon({ eventType }: { eventType: string }) {
  if (eventType === "status_change") {
    return (
      <div className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
        <Tag className="w-3 h-3 text-emerald-500" />
      </div>
    );
  }
  if (eventType === "items_edited") {
    return (
      <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shrink-0">
        <ClipboardEdit className="w-3 h-3 text-blue-400" />
      </div>
    );
  }
  if (eventType === "contact_edited") {
    return (
      <div className="w-6 h-6 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center shrink-0">
        <User className="w-3 h-3 text-purple-400" />
      </div>
    );
  }
  if (eventType === "note_added") {
    return (
      <div className="w-6 h-6 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center shrink-0">
        <MessageSquare className="w-3 h-3 text-yellow-400" />
      </div>
    );
  }
  return (
    <div className="w-6 h-6 rounded-full bg-surface-alt border border-border flex items-center justify-center shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-text-secondary" />
    </div>
  );
}

function ActivityTimeline({ events }: { events: OrderEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-text-secondary py-2">
        No activity recorded yet.
      </p>
    );
  }
  return (
    <div className="space-y-0">
      {events.map((event, idx) => (
        <div key={event.id} className="flex gap-3">
          {/* Timeline line + icon */}
          <div className="flex flex-col items-center">
            <EventIcon eventType={event.eventType} />
            {idx < events.length - 1 && (
              <div className="w-px flex-1 bg-border mt-1 mb-1" />
            )}
          </div>
          {/* Content */}
          <div
            className={`pb-3 min-w-0 flex-1 ${idx < events.length - 1 ? "" : ""}`}
          >
            <p className="text-xs text-text leading-snug">
              {eventDescription(event)}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-text-secondary">
                {event.actor}
              </span>
              <span className="text-[10px] text-text-secondary">·</span>
              <span className="text-[10px] text-text-secondary">
                {relativeTime(event.createdAt)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;
  const { data, isLoading, isError, mutate } = useAdminOrder(orderId);

  const [editMode, setEditMode] = useState<null | "items" | "customer">(null);
  const [transitioning, setTransitioning] = useState(false);
  const [savingItems, setSavingItems] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);

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
          href="/admin/orders"
          className="text-red-primary text-sm hover:underline mt-2 inline-block"
        >
          Back to orders
        </Link>
      </div>
    );
  }

  const { order } = data;
  const items: OrderItem[] = order.items ?? [];
  const vehicle = order.vehicleInfo;
  const vehicleStr = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")
    : null;
  const allowed = ORDER_TRANSITIONS[order.status] ?? [];
  const isEditable = EDITABLE_STATUSES.includes(order.status);

  const showEstimatePanel = ESTIMATE_STATUSES.has(order.status);
  const showQuotePanel = QUOTE_STATUSES.has(order.status);
  const showBookingPanel = BOOKING_STATUSES.has(order.status);

  async function handleTransition(newStatus: string) {
    if (newStatus === "cancelled") {
      const reason = prompt("Cancellation reason (optional):");
      if (reason === null) return;
      await doTransition(newStatus, reason || undefined);
    } else {
      await doTransition(newStatus);
    }
  }

  async function doTransition(newStatus: string, cancellationReason?: string) {
    setTransitioning(true);
    try {
      await authFetch(`/api/admin/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus, cancellationReason }),
      });
      mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setTransitioning(false);
    }
  }

  async function handleSaveItems(newItems: OrderItem[], newNotes: string) {
    setSavingItems(true);
    try {
      await authFetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ items: newItems, notes: newNotes }),
      });
      mutate();
      setEditMode(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save items");
    } finally {
      setSavingItems(false);
    }
  }

  async function handleSaveCustomer(data: {
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    contact_address: string;
  }) {
    setSavingCustomer(true);
    try {
      await authFetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      mutate();
      setEditMode(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save contact info");
    } finally {
      setSavingCustomer(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb + back */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/admin/orders")}
          className="flex items-center gap-1 text-xs text-text-secondary hover:text-text transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Orders
        </button>
        <span className="text-xs text-text-secondary">/</span>
        <span className="text-xs text-text font-medium">#{order.id}</span>
      </div>

      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-display font-bold text-text">
            Order #{order.id}
          </h1>
          <StatusBadge status={order.status} config={ORDER_STATUS} />
          {order.revisionNumber > 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
              v{order.revisionNumber}
            </span>
          )}
        </div>
        <span className="text-xs text-text-secondary">
          Created {formatDateTime(order.createdAt)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <OrderProgressBar status={order.status} />
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: main details */}
        <div className="lg:col-span-2 space-y-4">
          {/* Customer info */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">Contact</h2>
              <button
                type="button"
                onClick={() =>
                  setEditMode(editMode === "customer" ? null : "customer")
                }
                className="flex items-center gap-1 text-xs text-text-secondary hover:text-text"
                title="Edit contact"
              >
                <User className="w-3.5 h-3.5" />
                Edit
              </button>
            </div>

            {editMode === "customer" ? (
              <CustomerEditor
                order={order}
                saving={savingCustomer}
                onCancel={() => setEditMode(null)}
                onSave={handleSaveCustomer}
              />
            ) : (
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
            )}
          </div>

          {/* Vehicle */}
          {vehicleStr && (
            <div className="bg-surface border border-border rounded-xl p-4">
              <h2 className="text-sm font-semibold text-text mb-2">Vehicle</h2>
              <p className="text-xs text-text">{vehicleStr}</p>
            </div>
          )}

          {/* Items table */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">Line Items</h2>
              {isEditable && editMode !== "items" && (
                <button
                  type="button"
                  onClick={() => setEditMode("items")}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-text"
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              )}
            </div>

            {editMode === "items" && isEditable ? (
              <ItemEditor
                items={items}
                notes={order.notes}
                saving={savingItems}
                onCancel={() => setEditMode(null)}
                onSave={handleSaveItems}
              />
            ) : items.length > 0 ? (
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
              <p className="text-xs text-text-secondary">No items yet.</p>
            )}
          </div>

          {order.cancellationReason && (
            <div className="bg-surface border border-red-200 dark:border-red-900/50 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">
                Cancellation Reason
              </h2>
              <p className="text-xs text-text">{order.cancellationReason}</p>
            </div>
          )}
        </div>

        {/* Right sidebar: panels + actions */}
        <div className="space-y-4">
          {/* Status-contextual panels */}
          {showEstimatePanel && <EstimatePanel order={order} />}
          {showQuotePanel && <QuotePanel order={order} />}
          {showBookingPanel && <BookingPanel order={order} />}

          {/* Actions */}
          {allowed.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold text-text">Actions</h2>
              <div className="flex flex-col gap-2">
                {allowed.map((next) => {
                  const isDanger = DANGER_ACTIONS.has(next);
                  return (
                    <button
                      key={next}
                      type="button"
                      onClick={() => handleTransition(next)}
                      disabled={transitioning}
                      className={`w-full text-xs font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                        isDanger
                          ? "text-red-600 border border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20"
                          : "bg-red-primary text-white hover:bg-red-primary/90"
                      }`}
                    >
                      {TRANSITION_LABELS[next] ?? next}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Order metadata */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
            <h2 className="text-sm font-semibold text-text">Details</h2>
            <div className="text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-text-secondary">Order ID</span>
                <span className="text-text font-mono">#{order.id}</span>
              </div>
              {order.estimateId && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Estimate</span>
                  <span className="text-text font-mono">
                    #{order.estimateId}
                  </span>
                </div>
              )}
              {order.quoteId && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Quote</span>
                  <span className="text-text font-mono">#{order.quoteId}</span>
                </div>
              )}
              {order.bookingId && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Booking</span>
                  <span className="text-text font-mono">
                    #{order.bookingId}
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
        </div>
      </div>

      {/* Activity log */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-text mb-3">Activity</h2>
        <ActivityTimeline events={data.events ?? []} />
      </div>
    </div>
  );
}
