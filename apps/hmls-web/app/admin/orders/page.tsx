"use client";

import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { type AdminOrder, useAdminOrders } from "@/hooks/useAdmin";
import { authFetch } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/format";
import {
  EDITABLE_STATUSES,
  ORDER_STATUS,
  ORDER_TRANSITIONS,
} from "@/lib/status";
import type { OrderItem } from "@/lib/types";

const FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "estimated", label: "Estimated" },
  { value: "sent", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "revised", label: "Revised" },
  { value: "invoiced", label: "Invoiced" },
  { value: "paid", label: "Paid" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "void", label: "Void" },
  { value: "cancelled", label: "Cancelled" },
  { value: "archived", label: "Archived" },
];

/** Human-readable labels for transition actions. */
const TRANSITION_LABELS: Record<string, string> = {
  estimated: "Finalize Estimate",
  sent: "Send to Customer",
  approved: "Approve",
  declined: "Decline",
  revised: "Revise",
  invoiced: "Create Invoice",
  paid: "Mark Paid",
  void: "Void Invoice",
  scheduled: "Schedule",
  in_progress: "Start Work",
  completed: "Complete",
  archived: "Archive",
  cancelled: "Cancel",
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── Inline Item Editor ───────────────────────────────────────────────

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
        // Recompute totalCents when quantity or unitPriceCents changes
        if ("quantity" in patch || "unitPriceCents" in patch) {
          updated.totalCents = updated.quantity * updated.unitPriceCents;
        }
        return updated;
      }),
    );
  }

  function removeItem(index: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addItem() {
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
    ]);
  }

  return (
    <div className="mt-3 border border-border rounded-lg p-4 bg-surface-alt space-y-3">
      <h4 className="text-xs font-semibold text-text uppercase tracking-wide">
        Edit Items
      </h4>

      {editItems.map((item, idx) => (
        <div
          key={item.id}
          className="flex flex-wrap items-start gap-2 border-b border-border pb-3 last:border-0"
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
            className="flex-1 min-w-[140px] text-xs bg-surface border border-border rounded px-2 py-1.5 text-text"
          />
          <input
            type="text"
            placeholder="Description"
            value={item.description ?? ""}
            onChange={(e) => updateItem(idx, { description: e.target.value })}
            className="flex-1 min-w-[140px] text-xs bg-surface border border-border rounded px-2 py-1.5 text-text"
          />
          <input
            type="number"
            min={1}
            placeholder="Qty"
            value={item.quantity}
            onChange={(e) =>
              updateItem(idx, { quantity: Number(e.target.value) || 1 })
            }
            className="w-16 text-xs bg-surface border border-border rounded px-2 py-1.5 text-text text-right"
          />
          <input
            type="number"
            min={0}
            step={1}
            placeholder="Unit price (cents)"
            value={item.unitPriceCents}
            onChange={(e) =>
              updateItem(idx, {
                unitPriceCents: Number(e.target.value) || 0,
              })
            }
            className="w-28 text-xs bg-surface border border-border rounded px-2 py-1.5 text-text text-right"
          />
          <span className="text-xs text-text-secondary py-1.5 w-20 text-right">
            {formatCents(item.quantity * item.unitPriceCents)}
          </span>
          <button
            type="button"
            onClick={() => removeItem(idx)}
            className="text-red-500 hover:text-red-700 p-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addItem}
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

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-text-secondary hover:text-text hover:bg-surface transition-colors"
        >
          <X className="w-3.5 h-3.5" /> Cancel
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

// ─── Order Card ───────────────────────────────────────────────────────

function OrderCard({
  order,
  onTransition,
  onSaveItems,
  transitioning,
  savingItems,
}: {
  order: AdminOrder;
  onTransition: (orderId: number, newStatus: string) => void;
  onSaveItems: (orderId: number, items: OrderItem[], notes: string) => void;
  transitioning: number | null;
  savingItems: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const allowed = ORDER_TRANSITIONS[order.status] ?? [];
  const isEditable = EDITABLE_STATUSES.includes(order.status);
  const items: OrderItem[] = order.items ?? [];

  return (
    <div className="bg-surface border border-border rounded-xl p-5 hover:border-border-hover transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text">
              Order #{order.id}
            </h3>
            <StatusBadge status={order.status} config={ORDER_STATUS} />
            {order.revisionNumber > 1 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                Rev {order.revisionNumber}
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            {order.customer.name ?? "Unknown"}{" "}
            {order.customer.email && (
              <span>&middot; {order.customer.email}</span>
            )}
            {order.customer.phone && (
              <span>&middot; {order.customer.phone}</span>
            )}
          </p>
        </div>

        {/* Expand / Edit toggles */}
        <div className="flex items-center gap-1">
          {isEditable && !editing && (
            <button
              type="button"
              onClick={() => {
                setExpanded(true);
                setEditing(true);
              }}
              className="text-xs text-text-secondary hover:text-text p-1"
              title="Edit items & notes"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setExpanded((v) => !v);
              if (expanded) setEditing(false);
            }}
            className="text-xs text-text-secondary hover:text-text p-1"
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Linked entities */}
      <div className="flex flex-wrap gap-2 mb-3">
        {order.estimateId && (
          <a
            href="/admin/estimates"
            className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 hover:underline"
          >
            Estimate #{order.estimateId}
          </a>
        )}
        {order.quoteId && (
          <a
            href="/admin/quotes"
            className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 hover:underline"
          >
            Quote #{order.quoteId}
          </a>
        )}
        {order.bookingId && (
          <a
            href="/admin/bookings"
            className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 hover:underline"
          >
            Booking #{order.bookingId}
          </a>
        )}
        {order.vehicleInfo && (
          <span className="text-xs px-2 py-0.5 rounded bg-neutral-50 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {[
              order.vehicleInfo.year,
              order.vehicleInfo.make,
              order.vehicleInfo.model,
            ]
              .filter(Boolean)
              .join(" ")}
          </span>
        )}
      </div>

      {order.adminNotes && (
        <p className="text-xs text-text-secondary mb-3 italic">
          {order.adminNotes}
        </p>
      )}

      {order.cancellationReason && (
        <p className="text-xs text-red-500 mb-3">
          Reason: {order.cancellationReason}
        </p>
      )}

      {/* Expanded: items list or editor */}
      {expanded && !editing && items.length > 0 && (
        <div className="mb-3 border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-alt text-text-secondary">
                <th className="text-left px-3 py-1.5 font-medium">Item</th>
                <th className="text-left px-3 py-1.5 font-medium">Category</th>
                <th className="text-right px-3 py-1.5 font-medium">Qty</th>
                <th className="text-right px-3 py-1.5 font-medium">Unit</th>
                <th className="text-right px-3 py-1.5 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-3 py-1.5 text-text">
                    {item.name}
                    {item.description && (
                      <span className="block text-text-secondary">
                        {item.description}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-text-secondary capitalize">
                    {item.category}
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
                  colSpan={4}
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
          {order.notes && (
            <div className="px-3 py-2 border-t border-border text-xs text-text-secondary italic">
              {order.notes}
            </div>
          )}
        </div>
      )}

      {expanded && editing && isEditable && (
        <ItemEditor
          items={items}
          notes={order.notes}
          saving={savingItems === order.id}
          onCancel={() => setEditing(false)}
          onSave={(newItems, newNotes) => {
            onSaveItems(order.id, newItems, newNotes);
            setEditing(false);
          }}
        />
      )}

      {/* Footer: date + transition buttons */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">
          {formatDateTime(order.createdAt)}
        </span>

        {allowed.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {allowed.map((next) => {
              const isCancelling = next === "cancelled";
              const isVoid = next === "void";
              const label = TRANSITION_LABELS[next] ?? next;
              return (
                <button
                  key={next}
                  type="button"
                  onClick={() => onTransition(order.id, next)}
                  disabled={transitioning === order.id}
                  className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                    isCancelling || isVoid
                      ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      : "text-text hover:bg-surface-alt"
                  }`}
                >
                  {label}
                  <ChevronRight className="w-3 h-3" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [filter, setFilter] = useState("");
  const { orders, isLoading, mutate } = useAdminOrders(filter || undefined);
  const [transitioning, setTransitioning] = useState<number | null>(null);
  const [savingItems, setSavingItems] = useState<number | null>(null);

  async function handleTransition(orderId: number, newStatus: string) {
    if (newStatus === "cancelled") {
      const reason = prompt("Cancellation reason (optional):");
      if (reason === null) return; // user hit cancel on prompt
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
      alert(e instanceof Error ? e.message : "Failed to update order status");
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
      alert(e instanceof Error ? e.message : "Failed to save order items");
    } finally {
      setSavingItems(null);
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
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-display font-bold text-text">Orders</h1>
      </div>
      <p className="text-sm text-text-secondary mb-6">
        Track and manage the full order lifecycle.
      </p>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTER_OPTIONS.map((opt) => (
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
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          message={
            filter ? `No orders with status '${filter}'.` : "No orders yet."
          }
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onTransition={handleTransition}
              onSaveItems={handleSaveItems}
              transitioning={transitioning}
              savingItems={savingItems}
            />
          ))}
        </div>
      )}
    </div>
  );
}
