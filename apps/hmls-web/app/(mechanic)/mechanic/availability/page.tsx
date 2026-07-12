"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMechanicAvailability } from "@/hooks/useMechanic";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Slot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

function normalizeTime(t: string): string {
  // server returns HH:MM:SS, <input type=time> wants HH:MM
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export default function AvailabilityPage() {
  const { availability, isLoading, saveAvailability } =
    useMechanicAvailability();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Initialize slots once when availability first loads. After that, slots
  // is user-owned — SWR revalidations (focus, reconnect) don't blow away
  // in-progress edits. Saves call `saveAvailability` which mutates SWR,
  // and the local state stays in sync because we just sent it.
  const initializedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot init from SWR data
  useEffect(() => {
    if (initializedRef.current || isLoading) return;
    initializedRef.current = true;
    setSlots(
      availability.map((a) => ({
        dayOfWeek: a.dayOfWeek,
        startTime: normalizeTime(a.startTime),
        endTime: normalizeTime(a.endTime),
      })),
    );
  }, [isLoading]);

  function updateSlot(idx: number, patch: Partial<Slot>) {
    setSlots((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  function removeSlot(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }

  function addSlot() {
    setSlots((prev) => [
      ...prev,
      { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
    ]);
  }

  async function handleSave() {
    setError(null);
    // Validate
    for (const s of slots) {
      if (s.endTime <= s.startTime) {
        setError("End time must be after start time");
        return;
      }
    }
    try {
      setIsSaving(true);
      // Ensure HH:MM:SS format going to the API
      const payload = slots.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime.length === 5 ? `${s.startTime}:00` : s.startTime,
        endTime: s.endTime.length === 5 ? `${s.endTime}:00` : s.endTime,
      }));
      await saveAvailability(payload);
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Sort by dayOfWeek then startTime for stable display
  const sorted = [...slots]
    .map((s, originalIdx) => ({ s, originalIdx }))
    .sort((a, b) => {
      if (a.s.dayOfWeek !== b.s.dayOfWeek) return a.s.dayOfWeek - b.s.dayOfWeek;
      return a.s.startTime.localeCompare(b.s.startTime);
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">
          Weekly Hours
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add one or more time ranges per day. Customers can only book within
          these windows.
        </p>
      </div>

      <Card className="border-0">
        <CardContent className="p-4 space-y-3">
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hours set. Add a time range to start accepting bookings.
            </p>
          )}
          {sorted.map(({ s, originalIdx }) => (
            <div
              key={originalIdx}
              className="flex flex-col sm:flex-row sm:items-center gap-2"
            >
              <select
                value={s.dayOfWeek}
                onChange={(e) =>
                  updateSlot(originalIdx, { dayOfWeek: Number(e.target.value) })
                }
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
              >
                {DAY_LABELS.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={s.startTime}
                onChange={(e) =>
                  updateSlot(originalIdx, { startTime: e.target.value })
                }
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <input
                type="time"
                value={s.endTime}
                onChange={(e) =>
                  updateSlot(originalIdx, { endTime: e.target.value })
                }
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeSlot(originalIdx)}
                className="text-muted-foreground hover:text-red-500"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addSlot}>
            + Add time range
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save schedule"}
        </Button>
        {savedAt && (
          <span className="text-xs text-muted-foreground">
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
