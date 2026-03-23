"use client";

import {
  CalendarDays,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  XCircle,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { type AdminBooking, useAdminBookings } from "@/hooks/useAdmin";
import { formatDate, formatTime } from "@/lib/format";
import { BOOKING_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

/* ── Helpers ─────────────────────────────────────────────────────────── */

function getWeekBounds(weekOffset = 0) {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - day + weekOffset * 7);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return { startOfWeek, endOfWeek };
}

function groupByDay(bookings: AdminBooking[]): Map<string, AdminBooking[]> {
  const map = new Map<string, AdminBooking[]>();
  for (const b of bookings) {
    const key = new Date(b.scheduledAt).toDateString();
    const group = map.get(key) ?? [];
    group.push(b);
    map.set(key, group);
  }
  // Sort within each day by scheduledAt ascending
  for (const [key, group] of map) {
    map.set(
      key,
      group.sort(
        (a, b) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      ),
    );
  }
  return map;
}

function vehicleLabel(b: AdminBooking) {
  return [b.vehicleYear, b.vehicleMake, b.vehicleModel]
    .filter(Boolean)
    .join(" ");
}

/* ── Skeleton Loading ───────────────────────────────────────────────── */

function ScheduleSkeleton() {
  return (
    <div className="space-y-10">
      <Skeleton className="h-8 w-40" />
      <div className="space-y-4">
        <Skeleton className="h-5 w-48" />
        <div className="space-y-2">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Card key={id} className="py-0">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <Skeleton className="h-7 w-16 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <div className="flex gap-2 sm:flex-col">
                    <Skeleton className="h-7 w-20 rounded-md" />
                    <Skeleton className="h-7 w-20 rounded-md" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Reject Dialog ──────────────────────────────────────────────────── */

function RejectDialog({
  booking,
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
}: {
  booking: AdminBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (notes: string) => void;
  isSubmitting: boolean;
}) {
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject Booking</DialogTitle>
          <DialogDescription>
            Booking #{booking.id} &mdash;{" "}
            {booking.customer?.name ?? booking.customerName ?? "Unknown"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="reject-notes"
          >
            Reason / staff note{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </label>
          <Textarea
            id="reject-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. Outside service area, no availability that week..."
            className="resize-none"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(notes)}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Rejecting..." : "Reject Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Booking Card ────────────────────────────────────────────────────── */

function BookingCard({
  booking,
  onConfirm,
  onReject,
  showActions,
}: {
  booking: AdminBooking;
  onConfirm?: () => void;
  onReject?: () => void;
  showActions?: boolean;
}) {
  const name =
    booking.customer?.name ?? booking.customerName ?? "Unknown Customer";
  const vehicle = vehicleLabel(booking);
  const time = formatTime(booking.scheduledAt);
  const statusConfig = BOOKING_STATUS[booking.status];

  return (
    <Card className="py-0">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
        {/* Time pill */}
        <div className="shrink-0 text-center sm:w-16">
          <span className="text-xs font-semibold text-muted-foreground bg-muted border border-border rounded-lg px-2 py-1 inline-block">
            {time}
          </span>
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-foreground">
              #{booking.id}
            </span>
            {statusConfig && (
              <Badge className={cn("border-transparent", statusConfig.color)}>
                {statusConfig.label}
              </Badge>
            )}
          </div>
          <p className="text-sm text-foreground truncate">{name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {booking.serviceType}
          </p>
          {vehicle && (
            <p className="text-xs text-muted-foreground">{vehicle}</p>
          )}
          {booking.location && (
            <p className="text-xs text-muted-foreground truncate">
              {booking.location}
            </p>
          )}
          {booking.customerNotes && (
            <p className="text-xs text-muted-foreground mt-1 italic truncate">
              &ldquo;{booking.customerNotes}&rdquo;
            </p>
          )}
          {booking.staffNotes && (
            <p className="text-xs text-primary mt-1 italic truncate">
              Staff note: {booking.staffNotes}
            </p>
          )}
        </div>

        {/* Actions */}
        {showActions && (
          <div className="flex gap-2 shrink-0 sm:flex-col sm:items-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onConfirm}
              className="text-green-700 bg-green-100 hover:bg-green-200 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40"
            >
              <CheckCircle className="size-3.5" />
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onReject}
              className="text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
            >
              <XCircle className="size-3.5" />
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function SchedulePage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const { startOfWeek, endOfWeek } = getWeekBounds(weekOffset);
  const goToPrevWeek = useCallback(() => setWeekOffset((o) => o - 1), []);
  const goToNextWeek = useCallback(() => setWeekOffset((o) => o + 1), []);
  const goToCurrentWeek = useCallback(() => setWeekOffset(0), []);

  // Pending bookings — no date filter, just status=requested
  const {
    bookings: pendingBookings,
    isLoading: pendingLoading,
    confirmBooking,
    rejectBooking,
  } = useAdminBookings("requested");

  // This week's confirmed bookings
  const { bookings: weekBookings, isLoading: weekLoading } = useAdminBookings(
    "confirmed",
    startOfWeek.toISOString(),
    endOfWeek.toISOString(),
  );

  const [rejectTarget, setRejectTarget] = useState<AdminBooking | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const weekLabel = `${formatDate(startOfWeek.toISOString())} – ${formatDate(endOfWeek.toISOString())}`;
  const grouped = groupByDay(weekBookings);
  const sortedDays = [...grouped.keys()].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );

  async function handleConfirm(id: number) {
    setActionError(null);
    try {
      await confirmBooking(id);
    } catch {
      setActionError("Failed to confirm booking. Please try again.");
    }
  }

  async function handleRejectConfirm(notes: string) {
    if (!rejectTarget) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await rejectBooking(rejectTarget.id, notes || undefined);
      setRejectTarget(null);
    } catch {
      setActionError("Failed to reject booking. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (pendingLoading || weekLoading) {
    return <ScheduleSkeleton />;
  }

  return (
    <>
      {rejectTarget && (
        <RejectDialog
          booking={rejectTarget}
          open={!!rejectTarget}
          onOpenChange={(open) => {
            if (!open) setRejectTarget(null);
          }}
          onConfirm={handleRejectConfirm}
          isSubmitting={isSubmitting}
        />
      )}

      <div className="space-y-10">
        <h1 className="text-2xl font-display font-bold text-foreground">
          Schedule
        </h1>

        {actionError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-xl px-4 py-3">
            {actionError}
          </div>
        )}

        {/* ── Pending Confirmation ── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="size-4 text-amber-500" />
            <h2 className="text-base font-semibold text-foreground">
              Pending Confirmation
            </h2>
            {pendingBookings.length > 0 && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-transparent">
                {pendingBookings.length}
              </Badge>
            )}
          </div>

          {pendingBookings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="size-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  No pending bookings. You're all caught up.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {pendingBookings.map((b) => (
                <BookingCard
                  key={b.id}
                  booking={b}
                  showActions
                  onConfirm={() => handleConfirm(b.id)}
                  onReject={() => setRejectTarget(b)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── This Week's Schedule ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-blue-500" />
              <h2 className="text-base font-semibold text-foreground">
                {weekOffset === 0 ? "This Week" : "Schedule"}
              </h2>
              <span className="text-xs text-muted-foreground">{weekLabel}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={goToPrevWeek}>
                <ChevronLeft className="size-4" />
              </Button>
              {weekOffset !== 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goToCurrentWeek}
                  className="text-primary"
                >
                  Today
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={goToNextWeek}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          {weekBookings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <CalendarDays className="size-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  No confirmed bookings this week.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {sortedDays.map((dayKey) => {
                const dayBookings = grouped.get(dayKey) ?? [];
                const dayDate = new Date(dayKey);
                return (
                  <div key={dayKey}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {dayDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                    <div className="space-y-2">
                      {dayBookings.map((b) => (
                        <BookingCard key={b.id} booking={b} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
