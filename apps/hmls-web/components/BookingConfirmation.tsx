"use client";

import { motion } from "framer-motion";

export interface BookingConfirmationData {
  success: boolean;
  orderId?: number;
  bookingId?: number; // legacy — kept for backwards compat
  status?: string;
  providerName?: string;
  appointmentStart: string;
  appointmentEnd?: string;
  vehicle: string;
  serviceType: string;
  location: string;
  message: string;
}

interface BookingConfirmationProps {
  data: BookingConfirmationData;
}

export function BookingConfirmation({ data }: BookingConfirmationProps) {
  if (!data.success) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {data.message}
      </div>
    );
  }

  const startDate = new Date(data.appointmentStart);
  const endDate = data.appointmentEnd ? new Date(data.appointmentEnd) : null;

  const dateStr = startDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const startTime = startDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const endTime = endDate
    ? endDate.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl border border-green-200 bg-green-50 p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white text-xs"
          aria-hidden="true"
        >
          &#x2713;
        </div>
        <span className="font-semibold text-green-800">Booking Requested</span>
        <span className="ml-auto rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
          Awaiting Confirmation
        </span>
      </div>

      <div className="space-y-2 text-sm text-green-900">
        <div className="flex justify-between">
          <span className="text-green-700">Vehicle</span>
          <span className="font-medium">{data.vehicle}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-700">Service</span>
          <span className="font-medium">{data.serviceType}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-700">When</span>
          <span className="font-medium">
            {dateStr}, {startTime}
            {endTime ? ` \u2013 ${endTime}` : ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-700">Mechanic</span>
          <span className="font-medium">{data.providerName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-700">Location</span>
          <span className="font-medium truncate ml-4">{data.location}</span>
        </div>
      </div>

      <div className="mt-3 text-xs text-green-600">
        Order #{data.orderId ?? data.bookingId ?? "—"}
      </div>
    </motion.div>
  );
}
