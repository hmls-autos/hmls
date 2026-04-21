"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

export interface SlotPickerData {
  slots: Array<{
    providerId: number;
    providerName: string;
    isPreferred: boolean;
    availableTimes: string[];
  }>;
  serviceDurationMinutes: number;
  dateRange: { start: string; end: string };
  message: string;
}

interface SlotPickerProps {
  data: SlotPickerData;
  onSelect: (time: string) => void;
  disabled?: boolean;
}

type TimeBucket = "Morning" | "Afternoon" | "Evening";

function bucketFor(time: string): TimeBucket {
  const hour = new Date(time).getHours();
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTimeLabel(time: string): string {
  return new Date(time).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Customer view: we don't expose mechanic at all. Bookings are created unassigned;
// shop admin dispatches from the scheduler after the booking arrives.
export function SlotPicker({ data, onSelect, disabled }: SlotPickerProps) {
  const { dates, timesByDate } = useMemo(() => {
    const timesByDate = new Map<string, Set<string>>();

    for (const provider of data.slots) {
      for (const time of provider.availableTimes) {
        const dateKey = time.split("T")[0];
        let timeSet = timesByDate.get(dateKey);
        if (!timeSet) {
          timeSet = new Set();
          timesByDate.set(dateKey, timeSet);
        }
        timeSet.add(time);
      }
    }

    const dates = Array.from(timesByDate.keys()).sort();
    return { dates, timesByDate };
  }, [data.slots]);

  const [selectedDate, setSelectedDate] = useState<string>(dates[0] ?? "");
  const [selectedTime, setSelectedTime] = useState<string>("");

  if (data.slots.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-secondary">
        {data.message}
      </div>
    );
  }

  const timeSet = selectedDate
    ? (timesByDate.get(selectedDate) ?? new Set<string>())
    : new Set<string>();
  const times = Array.from(timeSet).sort();

  function handleConfirm() {
    if (selectedTime) {
      onSelect(selectedTime);
    }
  }

  const canConfirm = Boolean(selectedDate && selectedTime);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-surface p-4 space-y-3"
    >
      <div>
        <label
          htmlFor="slot-date"
          className="block text-xs font-medium text-text-secondary mb-1"
        >
          Date
        </label>
        <select
          id="slot-date"
          value={selectedDate}
          onChange={(e) => {
            setSelectedDate(e.target.value);
            setSelectedTime("");
          }}
          disabled={disabled}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-red-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary disabled:opacity-50"
        >
          {dates.map((d) => (
            <option key={d} value={d}>
              {formatDateLabel(d)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="slot-time"
          className="block text-xs font-medium text-text-secondary mb-1"
        >
          Time
        </label>
        <select
          id="slot-time"
          value={selectedTime}
          onChange={(e) => setSelectedTime(e.target.value)}
          disabled={disabled || times.length === 0}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-red-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary disabled:opacity-50"
        >
          <option value="" disabled>
            Select a time
          </option>
          {(["Morning", "Afternoon", "Evening"] as TimeBucket[]).map(
            (bucket) => {
              const inBucket = times.filter((t) => bucketFor(t) === bucket);
              if (inBucket.length === 0) return null;
              return (
                <optgroup key={bucket} label={bucket}>
                  {inBucket.map((t) => (
                    <option key={t} value={t}>
                      {formatTimeLabel(t)}
                    </option>
                  ))}
                </optgroup>
              );
            },
          )}
        </select>
      </div>

      <p className="text-[11px] text-text-secondary">
        Our team will assign a mechanic and confirm your appointment shortly.
      </p>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!canConfirm || disabled}
        className="w-full rounded-lg bg-red-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-dark disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-red-primary"
      >
        Confirm Appointment
      </button>
    </motion.div>
  );
}
