"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { ItemEditor } from "@/components/order/ItemEditor";
import { PdfPreviewDialog } from "@/components/order/PdfPreviewDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/ui/DateTime";
import { useOrderMutations } from "@/hooks/useOrderMutations";
import { AGENT_URL } from "@/lib/config";
import { formatCents } from "@/lib/format";
import { canonicalStatus } from "@/lib/status-display";
import type { SectionProps } from "./types";

export function ItemsSection({ order, readOnly, revalidate }: SectionProps) {
  const [editing, setEditing] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const { saveItems, savingItems } = useOrderMutations(order.id, revalidate);

  if (editing && !readOnly) {
    return (
      <Card className="gap-0 py-0 border-0">
        <CardHeader className="px-4 py-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Line items</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ItemEditor
            items={order.items ?? []}
            notes={order.notes ?? ""}
            saving={savingItems}
            onSave={async (items, notes) => {
              await saveItems(items, notes);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </CardContent>
      </Card>
    );
  }

  const items = order.items ?? [];
  const pdfUrl = order.shareToken
    ? `${AGENT_URL}/api/orders/${order.id}/pdf?token=${order.shareToken}`
    : `${AGENT_URL}/api/admin/orders/${order.id}/pdf`;
  // A price range only communicates pre-approval uncertainty. Once approved,
  // the total is firm — showing a range there reads like an unfinished quote.
  const status = canonicalStatus(order.status);
  const preApproval =
    status === "draft" || status === "estimated" || status === "declined";
  const showRange =
    preApproval &&
    (order.priceRangeLowCents != null || order.priceRangeHighCents != null);

  return (
    <>
      <Card className="gap-0 py-0 border-0">
        <CardHeader className="px-4 py-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Line items</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => setShowPdf(true)}>
              <FileText className="w-3 h-3" /> Preview
            </Button>
            <Button variant="ghost" size="xs" asChild>
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3 h-3" />
              </a>
            </Button>
            {!readOnly && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 text-xs space-y-1.5">
          {items.map((it) => (
            <div key={it.id} className="flex justify-between">
              <span className="text-foreground">
                <span className="text-[10px] uppercase text-muted-foreground mr-1.5">
                  {it.category}
                </span>
                {it.name}
              </span>
              <span className="text-muted-foreground">
                {formatCents(it.totalCents)}
              </span>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-muted-foreground">No items yet.</p>
          )}

          <div className="flex justify-between border-t border-border pt-2 mt-1">
            <span className="font-medium text-foreground">Total</span>
            <span className="font-semibold text-foreground">
              {formatCents(order.subtotalCents ?? 0)}
            </span>
          </div>
          {showRange && (
            <div className="flex justify-between text-muted-foreground">
              <span>Estimate range</span>
              <span>
                {order.priceRangeLowCents != null
                  ? formatCents(order.priceRangeLowCents)
                  : "—"}
                {" – "}
                {order.priceRangeHighCents != null
                  ? formatCents(order.priceRangeHighCents)
                  : "—"}
              </span>
            </div>
          )}
          {preApproval && order.expiresAt && (
            <p className="text-muted-foreground">
              Estimate expires{" "}
              <DateTime value={order.expiresAt} format="date" />
            </p>
          )}
        </CardContent>
      </Card>
      <PdfPreviewDialog
        open={showPdf}
        onOpenChange={setShowPdf}
        pdfUrl={pdfUrl}
        title={`Order #${order.id} — Document`}
      />
    </>
  );
}
