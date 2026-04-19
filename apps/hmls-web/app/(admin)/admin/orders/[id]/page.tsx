"use client";

import {
  ArrowLeft,
  Calendar,
  ClipboardEdit,
  ExternalLink,
  FileText,
  MapPin,
  MessageSquare,
  Pencil,
  Printer,
  Tag,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ReassignBookingDialog } from "@/components/admin/mechanics/ReassignBookingDialog";
import { OrderProgressBar } from "@/components/OrderProgressBar";
import { CustomerEditor } from "@/components/order/CustomerEditor";
import { ItemEditor } from "@/components/order/ItemEditor";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminOrder } from "@/hooks/useAdmin";
import {
  type OrderContactPatch,
  useOrderMutations,
} from "@/hooks/useOrderMutations";
import { AGENT_URL } from "@/lib/config";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import {
  EDITABLE_STATUSES,
  ORDER_STATUS,
  ORDER_STEP_LABELS_ADMIN,
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
          ORDER_STEP_LABELS_ADMIN[event.fromStatus] ?? event.fromStatus;
        const toLabel =
          ORDER_STEP_LABELS_ADMIN[event.toStatus] ?? event.toStatus;
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
  const [reassignOpen, setReassignOpen] = useState(false);
  const {
    transitionStatus,
    saveItems,
    saveCustomer,
    transitioning,
    savingItems,
    savingCustomer,
  } = useOrderMutations(orderId, mutate);

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
    let reason: string | undefined;
    if (newStatus === "cancelled") {
      const input = prompt("Cancellation reason (optional):");
      if (input === null) return;
      reason = input || undefined;
    }
    try {
      await transitionStatus(newStatus, reason);
    } catch {
      /* error toast shown by hook */
    }
  }

  async function handleSaveItems(newItems: OrderItem[], newNotes: string) {
    try {
      await saveItems(newItems, newNotes);
      setEditMode(null);
    } catch {
      /* error toast shown by hook */
    }
  }

  async function handleSaveCustomer(patch: OrderContactPatch) {
    try {
      await saveCustomer(patch);
      setEditMode(null);
    } catch {
      /* error toast shown by hook */
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
          <OrderProgressBar status={order.status} variant="admin" />
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Booking</span>
                    <span className="flex items-center gap-2">
                      <span className="text-foreground font-mono">
                        #{order.bookingId}
                      </span>
                      {data.booking && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReassignOpen(true)}
                        >
                          Reassign
                        </Button>
                      )}
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

      {data.booking && (
        <ReassignBookingDialog
          booking={data.booking}
          open={reassignOpen}
          onOpenChange={setReassignOpen}
          onReassigned={() => mutate()}
        />
      )}
    </div>
  );
}
