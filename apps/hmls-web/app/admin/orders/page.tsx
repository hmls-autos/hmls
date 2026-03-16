"use client";

import {
  Calendar,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Save,
  Trash2,
  User,
} from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { type AdminOrder, useAdminOrders } from "@/hooks/useAdmin";
import { authFetch } from "@/lib/fetcher";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import {
  EDITABLE_STATUSES,
  ORDER_STATUS,
  ORDER_TRANSITIONS,
} from "@/lib/status";
import type { OrderItem } from "@/lib/types";

/* ── Grouped filters ────────────────────────────────────────────────── */

const FILTER_GROUPS = [
  { value: "", label: "All" },
  { value: "sent", label: "Sent" },
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

const TRANSITION_LABELS: Record<string, string> = {
  estimated: "Finalize",
  sent: "Send",
  approved: "Approve",
  declined: "Decline",
  revised: "Revise",
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

/* Status groupings for contextual panels */
const ESTIMATE_STATUSES = new Set(["draft", "estimated", "revised"]);
const QUOTE_STATUSES = new Set(["sent", "approved", "invoiced"]);
const BOOKING_STATUSES = new Set([
  "paid",
  "scheduled",
  "in_progress",
  "completed",
]);

/* ── Customer Editor ────────────────────────────────────────────────── */

function CustomerEditor({
  order,
  onSave,
  onCancel,
  saving,
}: {
  order: AdminOrder;
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
    <div className="mt-3 border border-border rounded-lg p-4 bg-surface-alt space-y-3">
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

/* ── Item Editor ────────────────────────────────────────────────────── */

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
    <div className="mt-3 border border-border rounded-lg p-4 bg-surface-alt space-y-3">
      <h4 className="text-xs font-semibold text-text uppercase tracking-wide">
        Edit Items
      </h4>

      {editItems.map((item, idx) => (
        <div
          key={item.id}
          className="flex flex-wrap items-center gap-2 border-b border-border pb-2 last:border-0"
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
            className="flex-1 min-w-[120px] text-xs bg-surface border border-border rounded px-2 py-1.5 text-text"
          />
          <input
            type="number"
            min={1}
            value={item.quantity}
            onChange={(e) =>
              updateItem(idx, { quantity: Number(e.target.value) || 1 })
            }
            className="w-14 text-xs bg-surface border border-border rounded px-2 py-1.5 text-text text-right"
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
            className="w-24 text-xs bg-surface border border-border rounded px-2 py-1.5 text-text text-right"
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

/* ── Estimate Panel ─────────────────────────────────────────────────── */

function EstimatePanel({ order }: { order: AdminOrder }) {
  const vehicle = order.vehicleInfo;
  return (
    <div className="rounded-lg border border-border bg-surface-alt p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text uppercase tracking-wide">
          Estimate
        </span>
        {order.shareToken && (
          <a
            href={`/api/orders/${order.id}/pdf?token=${order.shareToken}`}
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

/* ── Quote Panel ────────────────────────────────────────────────────── */

function QuotePanel({ order }: { order: AdminOrder }) {
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

/* ── Booking Panel ──────────────────────────────────────────────────── */

function BookingPanel({ order }: { order: AdminOrder }) {
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

/* ── Order Card ─────────────────────────────────────────────────────── */

function OrderCard({
  order,
  onTransition,
  onSaveItems,
  onSaveCustomer,
  transitioning,
  savingItems,
  savingCustomer,
}: {
  order: AdminOrder;
  onTransition: (orderId: number, newStatus: string) => void;
  onSaveItems: (orderId: number, items: OrderItem[], notes: string) => void;
  onSaveCustomer: (
    orderId: number,
    data: {
      contact_name: string;
      contact_email: string;
      contact_phone: string;
      contact_address: string;
    },
  ) => void;
  transitioning: number | null;
  savingItems: number | null;
  savingCustomer: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState<null | "items" | "customer">(null);
  const allowed = ORDER_TRANSITIONS[order.status] ?? [];
  const isEditable = EDITABLE_STATUSES.includes(order.status);
  const items: OrderItem[] = order.items ?? [];
  const vehicle = order.vehicleInfo;
  const vehicleStr = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")
    : null;

  const showEstimatePanel = ESTIMATE_STATUSES.has(order.status);
  const showQuotePanel = QUOTE_STATUSES.has(order.status);
  const showBookingPanel = BOOKING_STATUSES.has(order.status);

  return (
    <div className="bg-surface border border-border rounded-xl p-4 hover:border-border-hover transition-colors">
      {/* Header */}
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
          if (expanded) setEditMode(null);
        }}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">#{order.id}</span>
            <StatusBadge status={order.status} config={ORDER_STATUS} />
            {order.revisionNumber > 1 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                v{order.revisionNumber}
              </span>
            )}
          </div>
          <span className="text-xs text-text-secondary truncate">
            {order.contactName ?? "Unknown"}
            {vehicleStr && ` · ${vehicleStr}`}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {items.length > 0 && (
            <span className="text-xs font-medium text-text">
              {formatCents(order.subtotalCents ?? 0)}
            </span>
          )}
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-text-secondary" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-secondary" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Customer info row — contact snapshot fields */}
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <div className="flex items-center gap-3">
              <span>{order.contactName ?? "—"}</span>
              {order.contactEmail && <span>{order.contactEmail}</span>}
              {order.contactPhone && <span>{order.contactPhone}</span>}
            </div>
            <button
              type="button"
              onClick={() =>
                setEditMode(editMode === "customer" ? null : "customer")
              }
              className="flex items-center gap-1 text-text-secondary hover:text-text"
              title="Edit customer"
            >
              <User className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Customer editor */}
          {editMode === "customer" && (
            <CustomerEditor
              order={order}
              saving={savingCustomer === order.id}
              onCancel={() => setEditMode(null)}
              onSave={(data) => {
                onSaveCustomer(order.id, data);
                setEditMode(null);
              }}
            />
          )}

          {/* Status-contextual panel */}
          {showEstimatePanel && editMode !== "items" && (
            <EstimatePanel order={order} />
          )}
          {showQuotePanel && <QuotePanel order={order} />}
          {showBookingPanel && <BookingPanel order={order} />}

          {/* Items list */}
          {editMode !== "items" && items.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-alt text-text-secondary">
                    <th className="text-left px-3 py-1.5 font-medium">Item</th>
                    <th className="text-right px-3 py-1.5 font-medium">Qty</th>
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
          )}

          {order.notes && editMode !== "items" && (
            <p className="text-xs text-text-secondary italic">{order.notes}</p>
          )}

          {order.cancellationReason && (
            <p className="text-xs text-red-500">
              Reason: {order.cancellationReason}
            </p>
          )}

          {/* Item editor */}
          {editMode === "items" && isEditable && (
            <ItemEditor
              items={items}
              notes={order.notes}
              saving={savingItems === order.id}
              onCancel={() => setEditMode(null)}
              onSave={(newItems, newNotes) => {
                onSaveItems(order.id, newItems, newNotes);
                setEditMode(null);
              }}
            />
          )}

          {/* Footer: date + actions */}
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <span className="text-xs text-text-secondary">
              {formatDateTime(order.createdAt)}
            </span>

            <div className="flex items-center gap-1">
              {isEditable && editMode !== "items" && (
                <button
                  type="button"
                  onClick={() => setEditMode("items")}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-text px-2 py-1 rounded hover:bg-surface-alt transition-colors"
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              )}
              {allowed.map((next) => {
                const isDanger = DANGER_ACTIONS.has(next);
                return (
                  <button
                    key={next}
                    type="button"
                    onClick={() => onTransition(order.id, next)}
                    disabled={transitioning === order.id}
                    className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 ${
                      isDanger
                        ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        : "text-text hover:bg-surface-alt"
                    }`}
                  >
                    {TRANSITION_LABELS[next] ?? next}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function OrdersPage() {
  const [filter, setFilter] = useState("");
  const [showMore, setShowMore] = useState(false);
  const { orders, isLoading, mutate } = useAdminOrders(filter || undefined);
  const [transitioning, setTransitioning] = useState<number | null>(null);
  const [savingItems, setSavingItems] = useState<number | null>(null);
  const [savingCustomer, setSavingCustomer] = useState<number | null>(null);

  const isMoreActive = MORE_FILTERS.some((f) => f.value === filter);

  async function handleTransition(orderId: number, newStatus: string) {
    if (newStatus === "cancelled") {
      const reason = prompt("Cancellation reason (optional):");
      if (reason === null) return;
      await doTransition(orderId, newStatus, reason || undefined);
    } else {
      await doTransition(orderId, newStatus);
    }
  }

  async function doTransition(
    orderId: number,
    newStatus: string,
    cancellationReason?: string,
  ) {
    setTransitioning(orderId);
    try {
      await authFetch(`/api/admin/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus, cancellationReason }),
      });
      mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setTransitioning(null);
    }
  }

  async function handleSaveItems(
    orderId: number,
    items: OrderItem[],
    notes: string,
  ) {
    setSavingItems(orderId);
    try {
      await authFetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ items, notes }),
      });
      mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save items");
    } finally {
      setSavingItems(null);
    }
  }

  async function handleSaveCustomer(
    orderId: number,
    data: {
      contact_name: string;
      contact_email: string;
      contact_phone: string;
      contact_address: string;
    },
  ) {
    setSavingCustomer(orderId);
    try {
      await authFetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save contact info");
    } finally {
      setSavingCustomer(null);
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
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onTransition={handleTransition}
              onSaveItems={handleSaveItems}
              onSaveCustomer={handleSaveCustomer}
              transitioning={transitioning}
              savingItems={savingItems}
              savingCustomer={savingCustomer}
            />
          ))}
        </div>
      )}
    </div>
  );
}
