"use client";

import {
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import type { AdminEstimate } from "@/hooks/useAdmin";
import { useAdminEstimates } from "@/hooks/useAdmin";
import { AGENT_URL } from "@/lib/config";
import { authFetch } from "@/lib/fetcher";
import { formatCents, formatDate } from "@/lib/format";
import type { LineItem } from "@/lib/types";

function EditForm({
  estimate,
  onSave,
  onCancel,
}: {
  estimate: AdminEstimate;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<LineItem[]>(
    estimate.items.map((i) => ({ ...i })),
  );
  const [notes, setNotes] = useState(estimate.notes ?? "");
  const [saving, setSaving] = useState(false);

  function updateItem(
    index: number,
    field: keyof LineItem,
    value: string | number,
  ) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems((prev) => [...prev, { name: "", description: "", price: 0 }]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await authFetch(`/api/admin/estimates/${estimate.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          items: items.map((i) => ({
            ...i,
            price:
              typeof i.price === "string"
                ? Math.round(Number(i.price) * 100)
                : i.price,
          })),
          notes: notes || null,
        }),
      });
      onSave();
    } catch {
      alert("Failed to save estimate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
            Line Items
          </span>
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-1 text-xs text-red-primary hover:text-red-600"
          >
            <Plus className="w-3 h-3" /> Add item
          </button>
        </div>
        {items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: editable list items without stable IDs
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1 grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                type="text"
                value={item.name}
                onChange={(e) => updateItem(i, "name", e.target.value)}
                placeholder="Service name"
                className="text-xs px-2.5 py-1.5 bg-background border border-border rounded-md text-text focus:outline-none focus:ring-1 focus:ring-red-primary"
              />
              <input
                type="text"
                value={item.description}
                onChange={(e) => updateItem(i, "description", e.target.value)}
                placeholder="Description"
                className="text-xs px-2.5 py-1.5 bg-background border border-border rounded-md text-text focus:outline-none focus:ring-1 focus:ring-red-primary"
              />
              <input
                type="number"
                value={item.price / 100}
                onChange={(e) =>
                  updateItem(
                    i,
                    "price",
                    Math.round(Number(e.target.value) * 100),
                  )
                }
                step="0.01"
                className="text-xs px-2.5 py-1.5 bg-background border border-border rounded-md text-text w-24 focus:outline-none focus:ring-1 focus:ring-red-primary"
              />
            </div>
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="text-text-secondary hover:text-red-500 mt-1.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div>
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
          Notes
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full text-xs px-2.5 py-1.5 bg-background border border-border rounded-md text-text focus:outline-none focus:ring-1 focus:ring-red-primary resize-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-red-primary text-white rounded-md hover:bg-red-600 disabled:opacity-50"
        >
          <Save className="w-3 h-3" />
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-text-secondary hover:text-text px-3 py-1.5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function EstimatesPage() {
  const { estimates, isLoading, mutate } = useAdminEstimates();
  const [deleting, setDeleting] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === estimates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(estimates.map((e) => e.id)));
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this estimate? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await authFetch(`/api/admin/estimates/${id}`, { method: "DELETE" });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      mutate();
    } catch {
      alert("Failed to delete estimate.");
    } finally {
      setDeleting(null);
    }
  }

  async function handleBatchDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} estimate${ids.length > 1 ? "s" : ""}? This cannot be undone.`,
      )
    )
      return;
    setBatchDeleting(true);
    try {
      await authFetch("/api/admin/estimates/batch", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
      setSelected(new Set());
      mutate();
    } catch {
      alert("Failed to delete estimates.");
    } finally {
      setBatchDeleting(false);
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
        <h1 className="text-2xl font-display font-bold text-text">Estimates</h1>
      </div>
      <p className="text-sm text-text-secondary mb-6">
        All customer estimates.
      </p>

      {/* Batch action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <span className="text-sm font-medium text-red-700 dark:text-red-400">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={handleBatchDelete}
            disabled={batchDeleting}
            className="ml-auto flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {batchDeleting ? "Deleting..." : "Delete selected"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-text-secondary hover:text-text"
          >
            Cancel
          </button>
        </div>
      )}

      {estimates.length === 0 ? (
        <EmptyState icon={FileText} message="No estimates yet." />
      ) : (
        <>
          {/* Select all */}
          <div className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              checked={
                selected.size === estimates.length && estimates.length > 0
              }
              onChange={toggleAll}
              className="w-4 h-4 rounded border-border text-red-primary focus:ring-red-primary/30 cursor-pointer"
            />
            <span className="text-xs text-text-secondary">Select all</span>
          </div>

          <div className="space-y-3">
            {estimates.map((e) => {
              const isExpired = new Date(e.expiresAt) < new Date();
              const isSelected = selected.has(e.id);
              const isEditing = editing === e.id;
              return (
                <div
                  key={e.id}
                  className={`bg-surface border rounded-xl p-5 hover:border-border-hover transition-colors ${
                    isSelected
                      ? "border-red-300 dark:border-red-700"
                      : "border-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(e.id)}
                        className="w-4 h-4 mt-0.5 rounded border-border text-red-primary focus:ring-red-primary/30 cursor-pointer"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-text">
                            {formatCents(e.priceRangeLow)} &ndash;{" "}
                            {formatCents(e.priceRangeHigh)}
                          </h3>
                          {e.vehicleInfo && (
                            <span className="text-xs text-text-secondary">
                              {[
                                e.vehicleInfo.year,
                                e.vehicleInfo.make,
                                e.vehicleInfo.model,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            </span>
                          )}
                          <a
                            href={`${AGENT_URL}/api/estimates/${e.id}/pdf?token=${e.shareToken}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-text-secondary hover:text-red-primary transition-colors"
                            title="View PDF"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() => setEditing(isEditing ? null : e.id)}
                            className="text-text-secondary hover:text-blue-500 transition-colors"
                            title="Edit estimate"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(e.id)}
                            disabled={deleting === e.id}
                            className="text-text-secondary hover:text-red-500 transition-colors disabled:opacity-50"
                            title="Delete estimate"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {e.customer.name ?? "Unknown"}{" "}
                          {e.customer.email && (
                            <span>&middot; {e.customer.email}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${
                        e.convertedToQuoteId
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : isExpired
                            ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      }`}
                    >
                      {e.convertedToQuoteId
                        ? "Converted"
                        : isExpired
                          ? "Expired"
                          : "Active"}
                    </span>
                  </div>

                  {/* Linked order */}
                  {e.orderId && (
                    <div className="flex flex-wrap gap-2 mb-3 ml-7">
                      <a
                        href="/admin/orders"
                        className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 hover:underline"
                      >
                        Order #{e.orderId}
                        {e.orderStatus &&
                          ` · ${e.orderStatus.replace(/_/g, " ")}`}
                      </a>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="ml-7">
                      <EditForm
                        estimate={e}
                        onSave={() => {
                          setEditing(null);
                          mutate();
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </div>
                  ) : (
                    <>
                      {/* Line items */}
                      <div className="space-y-1 mb-3 ml-7">
                        {e.items.map((item) => (
                          <div
                            key={item.name}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="text-text-secondary truncate">
                              {item.name}
                            </span>
                            <span className="text-text shrink-0 ml-2">
                              {formatCents(item.price)}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-text-secondary ml-7">
                        <span>Created {formatDate(e.createdAt)}</span>
                        <span>
                          {isExpired ? "Expired" : "Expires"}{" "}
                          {formatDate(e.expiresAt)}
                        </span>
                      </div>

                      {e.notes && (
                        <p className="mt-3 text-xs text-text-secondary border-t border-border pt-3 ml-7">
                          {e.notes}
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
