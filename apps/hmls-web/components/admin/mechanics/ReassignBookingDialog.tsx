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
import { assignMechanic, useAdminMechanics } from "@/hooks/useAdminMechanics";
import { formatDateTime } from "@/lib/format";
import type { Order } from "@/lib/types";

interface Props {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned?: () => void;
}

export function ReassignBookingDialog({
  order,
  open,
  onOpenChange,
  onAssigned,
}: Props) {
  const { mechanics } = useAdminMechanics();
  const [targetId, setTargetId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const candidates = useMemo(() => {
    return mechanics.filter((m) => m.isActive && m.id !== order?.providerId);
  }, [mechanics, order]);

  async function handleConfirm() {
    if (!order || targetId == null) return;
    setIsSaving(true);
    setError(null);
    try {
      await assignMechanic(order.id, targetId);
      setTargetId(null);
      onOpenChange(false);
      onAssigned?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {order?.providerId ? "Reassign mechanic" : "Assign mechanic"}
          </DialogTitle>
          {order && (
            <DialogDescription>
              Order #{order.id}
              {order.scheduledAt
                ? ` · ${formatDateTime(order.scheduledAt)}`
                : ""}
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
            {order?.providerId
              ? "Verify the target mechanic is free at this appointment time before confirming."
              : "Verify the selected mechanic is free at this appointment time before confirming."}
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
            {isSaving ? "Saving…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
