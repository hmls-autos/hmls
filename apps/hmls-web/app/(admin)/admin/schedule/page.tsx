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
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { type AdminBooking, useAdminBookings } from "@/hooks/useAdmin";
import { formatDate, formatTime } from "@/lib/format";
import { BOOKING_STATUS } from "@/lib/status";

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

/* ── Reject Modal ────────────────────────────────────────────────────── */

function RejectModal({
  booking,
  onConfirm,
  onCancel,
  isSubmitting,
}: {
  booking: AdminBooking;
  onConfirm: (notes: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [notes, setNotes] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b border-border">
          <h2 className="text-base font-semibold text-text">Reject Booking</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Booking #{booking.id} &mdash;{" "}
            {booking.customer?.name ?? booking.customerName ?? "Unknown"}
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label
            className="block text-sm font-medium text-text"
            htmlFor="reject-notes"
          >
            Reason / staff note{" "}
            <span className="text-text-secondary font-normal">(optional)</span>
          </label>
          <textarea
            id="reject-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. Outside service area, no availability that week…"
            className="w-full bg-surface-alt border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-secondary focus:outline-none focus:border-border-hover resize-none"
          />
        </div>
        <div className="p-5 border-t border-border flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm px-4 py-2 rounded-lg border border-border text-text-secondary hover:text-text hover:border-border-hover transition-colors"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(notes)}
            className="text-sm px-4 py-2 rounded-lg bg-red-primary text-white hover:bg-red-dark transition-colors disabled:opacity-50"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Rejecting…" : "Reject Booking"}
          </button>
        </div>
      </div>
    </div>
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

  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-start gap-3">
      {/* Time pill */}
      <div className="shrink-0 text-center sm:w-16">
        <span className="text-xs font-semibold text-text-secondary bg-surface-alt border border-border rounded-lg px-2 py-1 inline-block">
          {time}
        </span>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-text">#{booking.id}</span>
          <StatusBadge status={booking.status} config={BOOKING_STATUS} />
        </div>
        <p className="text-sm text-text truncate">{name}</p>
        <p className="text-xs text-text-secondary mt-0.5">
          {booking.serviceType}
        </p>
        {vehicle && <p className="text-xs text-text-secondary">{vehicle}</p>}
        {booking.location && (
          <p className="text-xs text-text-secondary truncate">
            {booking.location}
          </p>
        )}
        {booking.customerNotes && (
          <p className="text-xs text-text-secondary mt-1 italic truncate">
            &ldquo;{booking.customerNotes}&rdquo;
          </p>
        )}
        {booking.staffNotes && (
          <p className="text-xs text-red-primary mt-1 italic truncate">
            Staff note: {booking.staffNotes}
          </p>
        )}
      </div>

      {/* Actions */}
      {showActions && (
        <div className="flex gap-2 shrink-0 sm:flex-col sm:items-end">
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40 transition-colors"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Confirm
          </button>
          <button
            type="button"
            onClick={onReject}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      )}
    </div>
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
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      {rejectTarget && (
        <RejectModal
          booking={rejectTarget}
          onConfirm={handleRejectConfirm}
          onCancel={() => setRejectTarget(null)}
          isSubmitting={isSubmitting}
        />
      )}

      <div className="space-y-10">
        <h1 className="text-2xl font-display font-bold text-text">Schedule</h1>

        {actionError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-xl px-4 py-3">
            {actionError}
          </div>
        )}

        {/* ── Pending Confirmation ── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-amber-500" />
            <h2 className="text-base font-semibold text-text">
              Pending Confirmation
            </h2>
            {pendingBookings.length > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {pendingBookings.length}
              </span>
            )}
          </div>

          {pendingBookings.length === 0 ? (
            <EmptyState
              icon={CheckCircle}
              message="No pending bookings. You're all caught up."
            />
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
              <CalendarDays className="w-4 h-4 text-blue-500" />
              <h2 className="text-base font-semibold text-text">
                {weekOffset === 0 ? "This Week" : "Schedule"}
              </h2>
              <span className="text-xs text-text-secondary">{weekLabel}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goToPrevWeek}
                className="p-1.5 rounded-lg text-text-secondary hover:text-text hover:bg-surface-alt transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {weekOffset !== 0 && (
                <button
                  type="button"
                  onClick={goToCurrentWeek}
                  className="text-xs font-medium px-2 py-1 rounded-lg text-red-primary hover:bg-surface-alt transition-colors"
                >
                  Today
                </button>
              )}
              <button
                type="button"
                onClick={goToNextWeek}
                className="p-1.5 rounded-lg text-text-secondary hover:text-text hover:bg-surface-alt transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {weekBookings.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              message="No confirmed bookings this week."
            />
          ) : (
            <div className="space-y-6">
              {sortedDays.map((dayKey) => {
                const dayBookings = grouped.get(dayKey) ?? [];
                const dayDate = new Date(dayKey);
                return (
                  <div key={dayKey}>
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
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
