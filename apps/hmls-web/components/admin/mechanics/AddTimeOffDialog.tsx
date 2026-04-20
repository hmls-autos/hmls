"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminMechanicOverrides } from "@/hooks/useAdminMechanics";

interface Props {
  mechanicId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save so the caller can revalidate its own
   * ranged overrides cache (the hook inside this dialog only knows about
   * the unscoped key). */
  onSaved?: () => void | Promise<void>;
}

export function AddTimeOffDialog({
  mechanicId,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const { addOverride } = useAdminMechanicOverrides(mechanicId);
  const [date, setDate] = useState("");
  const [isAvailable, setIsAvailable] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    if (!date) {
      setError("Date is required");
      return;
    }
    if (isAvailable && (!startTime || !endTime)) {
      setError("Provide start and end time for extra-hours");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await addOverride({
        overrideDate: date,
        isAvailable,
        startTime: isAvailable
          ? startTime.length === 5
            ? `${startTime}:00`
            : startTime
          : undefined,
        endTime: isAvailable
          ? endTime.length === 5
            ? `${endTime}:00`
            : endTime
          : undefined,
        reason: reason.trim() || undefined,
      });
      setDate("");
      setStartTime("");
      setEndTime("");
      setReason("");
      setIsAvailable(false);
      onOpenChange(false);
      await onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add schedule override</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="to-date">Date</Label>
            <Input
              id="to-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isAvailable}
              onChange={(e) => setIsAvailable(e.target.checked)}
            />
            Extra hours (vs. full-day time off)
          </label>
          {isAvailable && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="to-start">Start</Label>
                <Input
                  id="to-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to-end">End</Label>
                <Input
                  id="to-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="to-reason">Reason (optional)</Label>
            <Input
              id="to-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
