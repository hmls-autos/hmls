"use client";

import {
  ArrowLeft,
  Calendar,
  Check,
  ClipboardEdit,
  ExternalLink,
  FileText,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  Printer,
  Save,
  Tag,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { cn } from "@/lib/utils";

/* ── Constants ────────────────────────────────────────────────────────── */

const TRANSITION_LABELS: Record<string, string> = {
  estimated: "Send",
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
const QUOTE_STATUSES = new Set([
  "estimated",
  "approved",
  "preauth",
  "invoiced",
]);
const BOOKING_STATUSES = new Set([
  "paid",
  "scheduled",
  "in_progress",
  "completed",
]);

/* ── Progress bar steps ───────────────────────────────────────────────── */

const MAIN_STEPS = [
  "draft",
  "estimated",
  "approved",
  "preauth",
  "scheduled",
  "in_progress",
  "invoiced",
  "paid",
] as const;

const MAIN_STEP_LABELS: Record<string, string> = {
  draft: "Draft",
  estimated: "Estimated",
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
    // declined/revised sit between estimated and approved
    if (currentStatus === "declined" || currentStatus === "revised") {
      const effectiveIdx = MAIN_STEPS.indexOf("estimated");
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

/* ── Status Badge (using shadcn Badge) ─────────────────────────────── */

function OrderStatusBadge({
  status,
  config,
}: {
  status: string;
  config: Record<string, { label: string; color: string }>;
}) {
  const entry = config[status] ?? {
    label: status,
    color: "bg-neutral-100 text-neutral-500",
  };
  return (
    <Badge variant="outline" className={cn("border-0", entry.color)}>
      {entry.label}
    </Badge>
  );
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
                  className={cn(
                    "h-0.5 w-4 sm:w-8 shrink-0",
                    state === "completed" || state === "current"
                      ? "bg-emerald-500"
                      : "bg-border",
                  )}
                />
              )}
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
                    state === "completed"
                      ? "bg-emerald-500 text-white"
                      : state === "current"
                        ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                        : "bg-card border-2 border-border text-muted-foreground",
                  )}
                >
                  {state === "completed" ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <span className="text-[10px]">{idx + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] leading-tight text-center whitespace-nowrap",
                    state === "current"
                      ? "font-semibold text-foreground"
                      : state === "completed"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground",
                  )}
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
          <OrderStatusBadge status={status} config={ORDER_STATUS} />
          {isBranch && (
            <span className="text-xs text-muted-foreground">
              {status === "declined"
                ? "Customer declined — revise or cancel"
                : "Revised estimate ready to re-send"}
            </span>
          )}
          {status === "cancelled" && (
            <span className="text-xs text-muted-foreground">
              Order was cancelled
            </span>
          )}
          {status === "void" && (
            <span className="text-xs text-muted-foreground">
              Invoice was voided
            </span>
          )}
          {status === "archived" && (
            <span className="text-xs text-muted-foreground">
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
    <div className="border border-border rounded-lg p-4 bg-muted space-y-3">
      <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">
        Edit Contact (this order only)
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-xs h-8"
        />
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="text-xs h-8"
        />
        <Input
          type="tel"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="text-xs h-8"
        />
      </div>
      <Textarea
        placeholder="Address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        rows={2}
        className="text-xs min-h-0 resize-y"
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() =>
            onSave({
              contact_name: name,
              contact_email: email,
              contact_phone: phone,
              contact_address: address,
            })
          }
          disabled={saving}
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save"}
        </Button>
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
    <div className="border border-border rounded-lg p-4 bg-muted space-y-3">
      <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">
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
            className="text-xs h-8 rounded-md border border-input bg-transparent px-2 py-1.5"
          >
            <option value="labor">Labor</option>
            <option value="parts">Parts</option>
            <option value="fee">Fee</option>
            <option value="discount">Discount</option>
          </select>
          <Input
            type="text"
            placeholder="Name"
            value={item.name}
            onChange={(e) => updateItem(idx, { name: e.target.value })}
            className="min-w-0 text-xs h-8"
          />
          <Input
            type="number"
            min={1}
            value={item.quantity}
            onChange={(e) =>
              updateItem(idx, { quantity: Number(e.target.value) || 1 })
            }
            className="w-full sm:w-14 text-xs h-8 text-right"
          />
          <Input
            type="number"
            min={0}
            step={0.01}
            placeholder="$"
            value={(item.unitPriceCents / 100).toFixed(2)}
            onChange={(e) =>
              updateItem(idx, {
                unitPriceCents: Math.round((Number(e.target.value) || 0) * 100),
              })
            }
            className="w-full sm:w-24 text-xs h-8 text-right"
          />
          <span className="text-xs text-muted-foreground w-16 text-right">
            {formatCents(item.quantity * item.unitPriceCents)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() =>
              setEditItems((prev) => prev.filter((_, i) => i !== idx))
            }
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
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
        className="text-muted-foreground"
      >
        <Plus className="w-3.5 h-3.5" /> Add item
      </Button>

      <div>
        <label
          htmlFor="item-editor-notes"
          className="text-xs font-medium text-muted-foreground block mb-1"
        >
          Notes
        </label>
        <Textarea
          id="item-editor-notes"
          value={editNotes}
          onChange={(e) => setEditNotes(e.target.value)}
          rows={2}
          className="text-xs min-h-0 resize-y"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onSave(editItems, editNotes)}
          disabled={saving}
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

/* ── PDF Preview Dialog ──────────────────────────────────────────────── */

function PdfPreviewDialog({
  open,
  onOpenChange,
  pdfUrl,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfUrl: string;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] p-0 gap-0">
        <DialogHeader className="px-4 py-2 border-b">
          <div className="flex items-center justify-between w-full">
            <DialogTitle className="text-sm">{title}</DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  const w = window.open(pdfUrl, "_blank");
                  if (w) w.addEventListener("load", () => w.print());
                }}
              >
                <Printer className="w-3 h-3" /> Print
              </Button>
              <Button variant="ghost" size="xs" asChild>
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3 h-3" /> Open
                </a>
              </Button>
            </div>
          </div>
        </DialogHeader>
        <iframe src={pdfUrl} className="w-full flex-1" title={title} />
      </DialogContent>
    </Dialog>
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
  const [showPdf, setShowPdf] = useState(false);
  const pdfUrl = order.shareToken
    ? `${AGENT_URL}/api/orders/${order.id}/pdf?token=${order.shareToken}`
    : null;

  return (
    <>
      <Card className="gap-0 py-0">
        <CardHeader className="px-3 py-3">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide">
            Estimate
          </CardTitle>
          {pdfUrl && (
            <CardAction>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowPdf(true)}
                >
                  <FileText className="w-3 h-3" /> Preview
                </Button>
                <Button variant="ghost" size="xs" asChild>
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </Button>
              </div>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-1.5">
          {vehicle && (
            <p className="text-xs text-muted-foreground">
              {[vehicle.year, vehicle.make, vehicle.model]
                .filter(Boolean)
                .join(" ")}
            </p>
          )}
          {(order.priceRangeLowCents != null ||
            order.priceRangeHighCents != null) && (
            <p className="text-xs text-foreground">
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
            <p className="text-xs text-muted-foreground">
              Expires {formatDate(order.expiresAt)}
            </p>
          )}
        </CardContent>
      </Card>

      {pdfUrl && (
        <PdfPreviewDialog
          open={showPdf}
          onOpenChange={setShowPdf}
          pdfUrl={pdfUrl}
          title={`Estimate PDF — Order #${order.id}`}
        />
      )}
    </>
  );
}

/* ── Quote Panel ──────────────────────────────────────────────────────── */

function QuotePanel({
  order,
}: {
  order: {
    id: number;
    shareToken: string | null;
    subtotalCents: number;
    stripeQuoteId: string | null;
    stripeInvoiceId: string | null;
    quoteId: number | null;
  };
}) {
  const [showPdf, setShowPdf] = useState(false);
  const pdfUrl = order.shareToken
    ? `${AGENT_URL}/api/orders/${order.id}/pdf?token=${order.shareToken}`
    : null;

  return (
    <>
      <Card className="gap-0 py-0">
        <CardHeader className="px-3 py-3">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide">
            Quote
          </CardTitle>
          {pdfUrl && (
            <CardAction>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowPdf(true)}
                >
                  <FileText className="w-3 h-3" /> Preview
                </Button>
                <Button variant="ghost" size="xs" asChild>
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </Button>
              </div>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-1.5">
          <p className="text-xs text-foreground">
            Total:{" "}
            <span className="font-semibold">
              {formatCents(order.subtotalCents ?? 0)}
            </span>
          </p>
          {order.stripeQuoteId && (
            <p className="text-xs text-muted-foreground">
              Stripe Quote:{" "}
              <span className="font-mono">{order.stripeQuoteId}</span>
            </p>
          )}
          {order.stripeInvoiceId && (
            <p className="text-xs text-muted-foreground">
              Invoice:{" "}
              <span className="font-mono">{order.stripeInvoiceId}</span>
            </p>
          )}
          {order.quoteId && (
            <p className="text-xs text-muted-foreground">
              Quote ID: #{order.quoteId}
            </p>
          )}
        </CardContent>
      </Card>

      {pdfUrl && (
        <PdfPreviewDialog
          open={showPdf}
          onOpenChange={setShowPdf}
          pdfUrl={pdfUrl}
          title={`Quote PDF — Order #${order.id}`}
        />
      )}
    </>
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
    <Card className="gap-0 py-0">
      <CardHeader className="px-3 py-3">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide">
          Booking
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-1.5">
        {vehicle && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3" />
            {[vehicle.year, vehicle.make, vehicle.model]
              .filter(Boolean)
              .join(" ")}
          </p>
        )}
        {order.bookingId && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="w-3 h-3" />
            Booking #{order.bookingId}
          </p>
        )}
        {order.adminNotes && (
          <>
            <Separator />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Admin notes:</span>{" "}
              {order.adminNotes}
            </p>
          </>
        )}
      </CardContent>
    </Card>
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
    <div className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
    </div>
  );
}

function ActivityTimeline({ events }: { events: OrderEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
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
          <div className="pb-3 min-w-0 flex-1">
            <p className="text-xs text-foreground leading-snug">
              {eventDescription(event)}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground">
                {event.actor}
              </span>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] text-muted-foreground">
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
      <div className="space-y-6 py-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-12" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-60 w-full rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data?.order) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Order not found.</p>
        <Link
          href="/admin/orders"
          className="text-primary text-sm hover:underline mt-2 inline-block"
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
        <Button
          variant="ghost"
          size="xs"
          onClick={() => router.push("/admin/orders")}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Orders
        </Button>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs text-foreground font-medium">#{order.id}</span>
      </div>

      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-display font-bold text-foreground">
            Order #{order.id}
          </h1>
          <OrderStatusBadge status={order.status} config={ORDER_STATUS} />
          {order.revisionNumber > 1 && (
            <Badge variant="secondary" className="text-[10px]">
              v{order.revisionNumber}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          Created {formatDateTime(order.createdAt)}
        </span>
      </div>

      {/* Progress bar */}
      <Card className="py-4 gap-0">
        <CardContent>
          <OrderProgressBar status={order.status} />
        </CardContent>
      </Card>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: main details */}
        <div className="lg:col-span-2 space-y-4">
          {/* Customer info */}
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-4">
              <CardTitle className="text-sm">Contact</CardTitle>
              <CardAction>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setEditMode(editMode === "customer" ? null : "customer")
                  }
                >
                  <User className="w-3.5 h-3.5" />
                  Edit
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="px-4 pb-4">
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
                    <span className="text-muted-foreground">Name</span>
                    <p className="text-foreground font-medium">
                      {order.contactName ?? "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email</span>
                    <p className="text-foreground font-medium">
                      {order.contactEmail ?? "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone</span>
                    <p className="text-foreground font-medium">
                      {order.contactPhone ?? "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Address</span>
                    <p className="text-foreground font-medium">
                      {order.contactAddress ?? "—"}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Vehicle */}
          {vehicleStr && (
            <Card className="gap-0 py-0">
              <CardHeader className="px-4 py-4">
                <CardTitle className="text-sm">Vehicle</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-xs text-foreground">{vehicleStr}</p>
              </CardContent>
            </Card>
          )}

          {/* Items table */}
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-4">
              <CardTitle className="text-sm">Line Items</CardTitle>
              {isEditable && editMode !== "items" && (
                <CardAction>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditMode("items")}
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
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
                        <tr className="bg-muted text-muted-foreground">
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
                            <td className="px-3 py-1.5 text-foreground">
                              <span className="text-[10px] uppercase text-muted-foreground mr-1.5">
                                {item.category}
                              </span>
                              {item.name}
                            </td>
                            <td className="px-3 py-1.5 text-right text-foreground">
                              {item.quantity}
                            </td>
                            <td className="px-3 py-1.5 text-right text-foreground">
                              {formatCents(item.unitPriceCents)}
                            </td>
                            <td className="px-3 py-1.5 text-right text-foreground font-medium">
                              {formatCents(item.totalCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border bg-muted">
                          <td
                            colSpan={3}
                            className="px-3 py-1.5 text-right font-medium text-foreground"
                          >
                            Subtotal
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold text-foreground">
                            {formatCents(order.subtotalCents ?? 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {order.notes && (
                    <p className="text-xs text-muted-foreground italic">
                      {order.notes}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No items yet.</p>
              )}
            </CardContent>
          </Card>

          {order.cancellationReason && (
            <Card className="gap-0 py-0 border-destructive/50">
              <CardHeader className="px-4 py-4">
                <CardTitle className="text-sm text-destructive">
                  Cancellation Reason
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-xs text-foreground">
                  {order.cancellationReason}
                </p>
              </CardContent>
            </Card>
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
            <Card className="gap-0 py-0">
              <CardHeader className="px-4 py-4">
                <CardTitle className="text-sm">Actions</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex flex-col gap-2">
                  {allowed.map((next) => {
                    const isDanger = DANGER_ACTIONS.has(next);
                    return (
                      <Button
                        key={next}
                        variant={isDanger ? "outline" : "default"}
                        size="sm"
                        className={cn(
                          "w-full",
                          isDanger &&
                            "text-destructive border-destructive/30 hover:bg-destructive/10",
                        )}
                        onClick={() => handleTransition(next)}
                        disabled={transitioning}
                      >
                        {TRANSITION_LABELS[next] ?? next}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Order metadata */}
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-4">
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order ID</span>
                  <span className="text-foreground font-mono">#{order.id}</span>
                </div>
                {order.estimateId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estimate</span>
                    <span className="text-foreground font-mono">
                      #{order.estimateId}
                    </span>
                  </div>
                )}
                {order.quoteId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quote</span>
                    <span className="text-foreground font-mono">
                      #{order.quoteId}
                    </span>
                  </div>
                )}
                {order.bookingId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Booking</span>
                    <span className="text-foreground font-mono">
                      #{order.bookingId}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="text-foreground">
                    {formatDateTime(order.updatedAt)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Activity log */}
      <Card className="gap-0 py-0">
        <CardHeader className="px-4 py-4">
          <CardTitle className="text-sm">Activity</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ActivityTimeline events={data.events ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
