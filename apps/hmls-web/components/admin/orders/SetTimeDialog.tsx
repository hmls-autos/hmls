"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing scheduledAt as ISO string, or null for first-time set. */
  initialScheduledAt: string | null;
  /** Existing durationMinutes; falls back to suggestedDurationMinutes. */
  initialDurationMinutes: number | null;
  /** Suggested duration computed from order item laborHours (used when no
   *  durationMinutes is set yet). */
  suggestedDurationMinutes: number;
  initialLocation?: string | null;
  saving: boolean;
  onSave: (
    scheduledAt: string,
    durationMinutes: number,
    location: string | null,
  ) => Promise<void>;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local wants YYYY-MM-DDTHH:mm in local time, no timezone suffix.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function SetTimeDialog({
  open,
  onOpenChange,
  initialScheduledAt,
  initialDurationMinutes,
  suggestedDurationMinutes,
  initialLocation,
  saving,
  onSave,
}: Props) {
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWhen(toLocalInputValue(initialScheduledAt));
    setDuration(
      String(initialDurationMinutes ?? suggestedDurationMinutes ?? 60),
    );
    setLocation(initialLocation ?? "");
    setError(null);
  }, [
    open,
    initialScheduledAt,
    initialDurationMinutes,
    suggestedDurationMinutes,
    initialLocation,
  ]);

  async function handleSave() {
    if (!when) {
      setError("Pick a date and time");
      return;
    }
    const dur = Number(duration);
    if (!Number.isInteger(dur) || dur <= 0) {
      setError("Duration must be a positive number of minutes");
      return;
    }
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) {
      setError("Invalid date/time");
      return;
    }
    setError(null);
    try {
      await onSave(date.toISOString(), dur, location.trim() || null);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  const isReschedule = initialScheduledAt != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isReschedule ? "Reschedule appointment" : "Set appointment time"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label
              htmlFor="schedule-when"
              className="block text-xs font-medium text-muted-foreground mb-1"
            >
              Date &amp; time
            </label>
            <input
              id="schedule-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm bg-background"
            />
          </div>
          <div>
            <label
              htmlFor="schedule-duration"
              className="block text-xs font-medium text-muted-foreground mb-1"
            >
              Duration (minutes)
            </label>
            <input
              id="schedule-duration"
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm bg-background"
            />
            {!initialDurationMinutes && suggestedDurationMinutes > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Suggested {suggestedDurationMinutes} min based on order labor
                hours.
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="schedule-location"
              className="block text-xs font-medium text-muted-foreground mb-1"
            >
              Location (optional)
            </label>
            <input
              id="schedule-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Service address"
              className="w-full rounded-md border border-border px-3 py-2 text-sm bg-background"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
