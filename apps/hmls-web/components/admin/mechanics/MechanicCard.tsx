"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MechanicListRow } from "@/hooks/useAdminMechanics";
import { formatCents, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UtilizationBar } from "./UtilizationBar";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface Props {
  mechanic: MechanicListRow;
  onToggleActive: (m: MechanicListRow) => Promise<void>;
}

export function MechanicCard({ mechanic: m, onToggleActive }: Props) {
  const [isToggling, setIsToggling] = useState(false);

  const dotClass = m.isOnJobNow
    ? "bg-amber-500"
    : m.isActive
      ? "bg-emerald-500"
      : "bg-neutral-400";
  const dotLabel = m.isOnJobNow
    ? "On a job now"
    : m.isActive
      ? "Active"
      : "Inactive";

  async function handleToggle() {
    setIsToggling(true);
    try {
      await onToggleActive(m);
    } finally {
      setIsToggling(false);
    }
  }

  return (
    <Card className="p-0 border-0">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="size-10 shrink-0 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-sm font-semibold">
            {initials(m.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-foreground truncate">{m.name}</p>
              <span
                role="status"
                className={cn("size-2 rounded-full shrink-0", dotClass)}
                aria-label={dotLabel}
                title={dotLabel}
              />
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {m.email ?? "No email"} · {m.phone ?? "No phone"}
            </p>
          </div>
        </div>

        <UtilizationBar percent={m.weekUtilization} />

        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>
            <span className="font-medium text-foreground">Next:</span>{" "}
            {m.nextBookingAt
              ? formatDateTime(m.nextBookingAt)
              : "No upcoming bookings"}
          </p>
          <p>
            <span className="font-medium text-foreground">Upcoming:</span>{" "}
            {m.upcomingBookingsCount} job
            {m.upcomingBookingsCount === 1 ? "" : "s"} this week
          </p>
          <p>
            <span className="font-medium text-foreground">Earnings (30d):</span>{" "}
            {formatCents(m.earnings30d)}
          </p>
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggle}
            disabled={isToggling}
          >
            {m.isActive ? "Deactivate" : "Reactivate"}
          </Button>
          <Link
            href={`/admin/mechanics/${m.id}`}
            className="text-sm text-primary font-medium hover:text-primary/80"
          >
            View →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
