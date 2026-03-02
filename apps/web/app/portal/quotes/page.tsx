"use client";

import { Receipt } from "lucide-react";
import { usePortalQuotes } from "@/hooks/usePortal";

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
  accepted:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  invoiced:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  paid: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

export default function QuotesPage() {
  const { quotes, isLoading } = usePortalQuotes();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-red-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-text mb-1">Quotes</h1>
      <p className="text-sm text-text-secondary mb-8">
        Formal quotes and invoices for your services.
      </p>

      {quotes.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <Receipt className="w-8 h-8 text-text-secondary mx-auto mb-3" />
          <p className="text-text-secondary text-sm">No quotes yet.</p>
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
                  <h3 className="text-sm font-semibold text-text">
                    Quote #{q.id}
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Created {formatDate(q.createdAt)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-text">
                    {formatCents(q.totalAmount)}
                  </p>
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full inline-block mt-1 capitalize ${
                      statusStyles[q.status] ?? statusStyles.draft
                    }`}
                  >
                    {q.status}
                  </span>
                </div>
              </div>

              {/* Line items */}
              <div className="border-t border-border pt-3 space-y-2">
                {q.items.map((item) => (
                  <div
                    key={`${item.service}-${item.description ?? ""}`}
                    className="flex items-start justify-between gap-4 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="text-text font-medium">{item.service}</p>
                      {item.description && (
                        <p className="text-text-secondary mt-0.5">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <span className="text-text-secondary shrink-0">
                      {formatCents(item.amount ?? 0)}
                    </span>
                  </div>
                ))}
              </div>

              {q.expiresAt && (
                <p className="mt-3 pt-3 border-t border-border text-xs text-text-secondary">
                  Expires {formatDate(q.expiresAt)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
