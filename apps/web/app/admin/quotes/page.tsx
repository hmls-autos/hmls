"use client";

import { DollarSign, Receipt } from "lucide-react";
import { useState } from "react";
import { useAdminQuotes } from "@/hooks/useAdmin";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const statusStyles: Record<string, string> = {
  draft:
    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  viewed:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  accepted:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  paid: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  declined: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  expired:
    "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

const statusFilters = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "paid", label: "Paid" },
  { value: "declined", label: "Declined" },
];

export default function QuotesPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const { quotes, isLoading } = useAdminQuotes(statusFilter || undefined);

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-text mb-1">Quotes</h1>
      <p className="text-sm text-text-secondary mb-6">
        All customer quotes and payment status.
      </p>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {statusFilters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === f.value
                ? "bg-red-primary text-white"
                : "bg-surface border border-border text-text-secondary hover:text-text hover:border-border-hover"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-red-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : quotes.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <Receipt className="w-8 h-8 text-text-secondary mx-auto mb-3" />
          <p className="text-sm text-text-secondary">
            {statusFilter ? "No quotes with this status." : "No quotes yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map((q) => (
            <div
              key={q.id}
              className="bg-surface border border-border rounded-xl p-5 hover:border-border-hover transition-colors"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-text-secondary" />
                    <h3 className="text-sm font-semibold text-text">
                      {formatCents(q.totalAmount)}
                    </h3>
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {q.customer?.name ?? "Unknown"}{" "}
                    {q.customer?.email && (
                      <span>&middot; {q.customer.email}</span>
                    )}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize whitespace-nowrap ${
                    statusStyles[q.status] ?? statusStyles.draft
                  }`}
                >
                  {q.status}
                </span>
              </div>

              {/* Line items */}
              {q.items && q.items.length > 0 && (
                <div className="space-y-1 mb-3">
                  {q.items.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-text-secondary truncate">
                        {item.name}
                      </span>
                      <span className="text-text shrink-0 ml-2">
                        {formatCents(item.price ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-4 text-xs text-text-secondary">
                <span>Created {formatDate(q.createdAt)}</span>
                {q.stripePaymentUrl && q.status !== "paid" && (
                  <a
                    href={q.stripePaymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-primary hover:text-red-dark font-medium"
                  >
                    Payment link
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
