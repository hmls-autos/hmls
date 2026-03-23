"use client";

import { Calendar, Clock, MapPin, X as XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { type PortalBooking, usePortalBookings } from "@/hooks/usePortal";
import { authFetch } from "@/lib/fetcher";
import { formatDate, formatTime } from "@/lib/format";
import { BOOKING_STATUS } from "@/lib/status";

function BookingCard({
  booking,
  onCancel,
  loading,
}: {
  booking: PortalBooking;
  onCancel: (bookingId: number) => void;
  loading: number | null;
}) {
  const canCancel = booking.status === "requested";
  const vehicle = [
    booking.vehicleYear,
    booking.vehicleMake,
    booking.vehicleModel,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="bg-surface border border-border rounded-xl p-5 hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">
              {booking.serviceType}
            </span>
            <StatusBadge status={booking.status} config={BOOKING_STATUS} />
          </div>
          {vehicle && (
            <p className="text-xs text-text-secondary mt-0.5">{vehicle}</p>
          )}
        </div>
        <span className="text-xs text-text-secondary shrink-0">
          Booking #{booking.id}
        </span>
      </div>

      {/* Date/Time + Location */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>{formatDate(booking.scheduledAt)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>
            {formatTime(booking.scheduledAt)}
            {booking.durationMinutes ? ` (${booking.durationMinutes} min)` : ""}
          </span>
        </div>
        {booking.location && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{booking.location}</span>
          </div>
        )}
      </div>

      {/* Notes */}
      {booking.customerNotes && (
        <p className="text-xs text-text-secondary mb-3 bg-surface-alt rounded-lg px-3 py-2">
          {booking.customerNotes}
        </p>
      )}

      {/* Staff notes (rejection reason) */}
      {booking.staffNotes && (
        <p className="text-xs text-red-500 mb-3">
          Staff note: {booking.staffNotes}
        </p>
      )}

      {/* Linked order */}
      {booking.estimateId && (
        <div className="flex flex-wrap gap-2 mb-3">
          <Link
            href="/portal/orders"
            className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 hover:underline"
          >
            Estimate #{booking.estimateId}
          </Link>
        </div>
      )}

      {/* Cancel action */}
      {canCancel && (
        <div className="flex gap-2 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => onCancel(booking.id)}
            disabled={loading === booking.id}
            className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
          >
            <XIcon className="w-3.5 h-3.5" />
            {loading === booking.id ? "Cancelling..." : "Cancel Request"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function PortalBookingsPage() {
  const { bookings, isLoading, mutate } = usePortalBookings();
  const [loading, setLoading] = useState<number | null>(null);

  async function handleCancel(bookingId: number) {
    const reason = prompt("Reason for cancelling (optional):");
    if (reason === null) return;

    setLoading(bookingId);
    try {
      await authFetch(`/api/portal/me/bookings/${bookingId}/cancel`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to cancel booking");
    } finally {
      setLoading(null);
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
      <PageHeader
        title="My Bookings"
        subtitle="View and manage your service appointments."
      />

      {bookings.length === 0 ? (
        <EmptyState
          icon={Calendar}
          message="No bookings yet. Start a chat to schedule an appointment!"
        />
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              onCancel={handleCancel}
              loading={loading}
            />
          ))}
        </div>
      )}
    </div>
  );
}
