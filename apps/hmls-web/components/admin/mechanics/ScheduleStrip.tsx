"use client";

import { useMemo } from "react";
import type { ScheduleOverride, WeeklyRow } from "@/hooks/useAdminMechanics";
import type { Booking } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  weekly: WeeklyRow[];
  overrides: ScheduleOverride[];
  bookings: Booking[];
  /** Inclusive — first day of strip. Defaults to today. */
  startDate?: Date;
}

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 20;
const TOTAL_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

function toMin(hm: string) {
  const [h, m] = hm.split(":");
  return Number(h) * 60 + Number(m);
}

function minutesToHM(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function bookingColor(status: string): string {
  switch (status) {
    case "confirmed":
      return "bg-blue-500";
    case "requested":
      return "bg-amber-500";
    case "completed":
      return "bg-green-500";
    case "rejected":
    case "cancelled":
      return "bg-neutral-400";
    default:
      return "bg-purple-500";
  }
}

export function ScheduleStrip({
  weekly,
  overrides,
  bookings,
  startDate,
}: Props) {
  const days = useMemo(() => {
    const start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [startDate]);

  const weeklyByDow = useMemo(() => {
    const m = new Map<number, WeeklyRow[]>();
    for (const w of weekly) {
      const list = m.get(w.dayOfWeek) ?? [];
      list.push(w);
      m.set(w.dayOfWeek, list);
    }
    return m;
  }, [weekly]);

  const overrideByDate = useMemo(() => {
    const m = new Map<string, ScheduleOverride>();
    for (const o of overrides) m.set(o.overrideDate, o);
    return m;
  }, [overrides]);

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const dateKey = day.toISOString().slice(0, 10);
        const dow = day.getDay();
        const override = overrideByDate.get(dateKey);

        // Unavailable override blanks the day. Extra-hours override stacks
        // on top of the weekly schedule (matches backend utilization math).
        let availableRanges: Array<{ startMin: number; endMin: number }> = [];
        const blanked = override && !override.isAvailable;
        if (!blanked) {
          availableRanges = (weeklyByDow.get(dow) ?? []).map((w) => ({
            startMin: toMin(w.startTime),
            endMin: toMin(w.endTime),
          }));
          if (override?.isAvailable && override.startTime && override.endTime) {
            availableRanges.push({
              startMin: toMin(override.startTime),
              endMin: toMin(override.endTime),
            });
          }
        }

        const dayStart = DAY_START_HOUR * 60;
        const dayEnd = DAY_END_HOUR * 60;

        const dayBookings = bookings.filter((b) => {
          const d = new Date(b.scheduledAt);
          return d.toISOString().slice(0, 10) === dateKey;
        });

        return (
          <div key={dateKey} className="flex flex-col">
            <div className="text-xs font-medium text-muted-foreground text-center mb-1">
              {day.toLocaleDateString("en-US", {
                weekday: "short",
                month: "numeric",
                day: "numeric",
              })}
            </div>
            <div className="relative h-56 rounded-md bg-muted overflow-hidden border border-border">
              {availableRanges.map((r) => {
                const top =
                  ((Math.max(r.startMin, dayStart) - dayStart) /
                    TOTAL_MINUTES) *
                  100;
                const height =
                  ((Math.min(r.endMin, dayEnd) -
                    Math.max(r.startMin, dayStart)) /
                    TOTAL_MINUTES) *
                  100;
                if (height <= 0) return null;
                return (
                  <div
                    key={`${r.startMin}-${r.endMin}`}
                    className="absolute left-0 right-0 bg-green-100 dark:bg-green-900/20"
                    style={{ top: `${top}%`, height: `${height}%` }}
                  />
                );
              })}

              {dayBookings.map((b) => {
                const d = new Date(b.scheduledAt);
                const startMin = d.getHours() * 60 + d.getMinutes();
                const endMin = startMin + b.durationMinutes;
                const top =
                  ((Math.max(startMin, dayStart) - dayStart) / TOTAL_MINUTES) *
                  100;
                const height =
                  ((Math.min(endMin, dayEnd) - Math.max(startMin, dayStart)) /
                    TOTAL_MINUTES) *
                  100;
                if (height <= 0) return null;
                return (
                  <div
                    key={b.id}
                    className={cn(
                      "absolute left-1 right-1 rounded px-1 text-[10px] text-white font-medium truncate",
                      bookingColor(b.status),
                    )}
                    style={{ top: `${top}%`, height: `${height}%` }}
                    title={`${minutesToHM(startMin)} ${b.serviceType}`}
                  >
                    {minutesToHM(startMin)} {b.serviceType}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
