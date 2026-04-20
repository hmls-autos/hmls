"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { reassignBooking, useAdminMechanics } from "@/hooks/useAdminMechanics";
import { formatDateTime } from "@/lib/format";
import type { Booking } from "@/lib/types";

interface Props {
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReassigned?: () => void;
}

export function ReassignBookingDialog({
  booking,
  open,
  onOpenChange,
  onReassigned,
}: Props) {
  const { mechanics } = useAdminMechanics();
  const [targetId, setTargetId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const candidates = useMemo(() => {
    return mechanics.filter((m) => m.isActive && m.id !== booking?.providerId);
  }, [mechanics, booking]);

  async function handleConfirm() {
    if (!booking || targetId == null) return;
    setIsSaving(true);
    setError(null);
    try {
      await reassignBooking(booking.id, targetId);
      setTargetId(null);
      onOpenChange(false);
      onReassigned?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reassign");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign booking</DialogTitle>
          {booking && (
            <DialogDescription>
              #{booking.id} · {formatDateTime(booking.scheduledAt)} ·{" "}
              {booking.serviceType}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <select
            value={targetId ?? ""}
            onChange={(e) =>
              setTargetId(e.target.value ? Number(e.target.value) : null)
            }
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background"
          >
            <option value="">Select a mechanic…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Admin can reassign regardless of schedule conflicts — verify the
            target mechanic is free at this booking's time before confirming.
          </p>
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
          <Button
            onClick={handleConfirm}
            disabled={isSaving || targetId == null}
          >
            {isSaving ? "Reassigning..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
