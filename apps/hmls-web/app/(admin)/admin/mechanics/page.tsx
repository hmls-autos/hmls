"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { AddMechanicDialog } from "@/components/admin/mechanics/AddMechanicDialog";
import { MechanicCard } from "@/components/admin/mechanics/MechanicCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type MechanicListRow,
  useAdminMechanics,
} from "@/hooks/useAdminMechanics";
import { authFetch } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "inactive" | "available-today";

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4 gap-0">
      <CardContent className="p-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-display font-bold text-foreground tabular-nums">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium border transition",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

export default function MechanicsPage() {
  const { mechanics, isLoading, mutate } = useAdminMechanics();
  const [filter, setFilter] = useState<Filter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "all") return mechanics;
    if (filter === "active") return mechanics.filter((m) => m.isActive);
    if (filter === "inactive") return mechanics.filter((m) => !m.isActive);
    return mechanics.filter((m) => m.isActive && m.weekUtilization !== null);
  }, [mechanics, filter]);

  const stats = useMemo(() => {
    const active = mechanics.filter((m) => m.isActive);
    const utilValues = mechanics
      .map((m) => m.weekUtilization)
      .filter((u): u is number => u != null);
    const avg = utilValues.length
      ? Math.round(utilValues.reduce((a, b) => a + b, 0) / utilValues.length)
      : null;
    const bookingsThisWeek = mechanics.reduce(
      (acc, m) => acc + m.upcomingBookingsCount,
      0,
    );
    return {
      total: mechanics.length,
      active: active.length,
      avg,
      bookingsThisWeek,
    };
  }, [mechanics]);

  async function toggleActive(m: MechanicListRow) {
    if (m.isActive) {
      await authFetch(`/api/admin/mechanics/${m.id}`, { method: "DELETE" });
    } else {
      await authFetch(`/api/admin/mechanics/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      });
    }
    await mutate();
  }

  if (isLoading) {
    return (
      <div>
        <Skeleton className="h-8 w-40 mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {["k1", "k2", "k3", "k4"].map((k) => (
            <Skeleton key={k} className="h-20 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {["m1", "m2", "m3"].map((k) => (
            <Skeleton key={k} className="h-60 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-foreground">
          Mechanics
        </h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" /> Add Mechanic
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile label="Total" value={String(stats.total)} />
        <KpiTile label="Active" value={String(stats.active)} />
        <KpiTile
          label="Avg utilization"
          value={stats.avg == null ? "—" : `${stats.avg}%`}
        />
        <KpiTile
          label="Bookings (week)"
          value={String(stats.bookingsThisWeek)}
        />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </FilterChip>
        <FilterChip
          active={filter === "active"}
          onClick={() => setFilter("active")}
        >
          Active
        </FilterChip>
        <FilterChip
          active={filter === "inactive"}
          onClick={() => setFilter("inactive")}
        >
          Inactive
        </FilterChip>
        <FilterChip
          active={filter === "available-today"}
          onClick={() => setFilter("available-today")}
        >
          Available today
        </FilterChip>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6 text-center">
          <CardContent className="p-0">
            <p className="text-sm text-muted-foreground">
              {mechanics.length === 0
                ? "No mechanics yet. Add your first to get started."
                : "No mechanics match this filter."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <MechanicCard
              key={m.id}
              mechanic={m}
              onToggleActive={toggleActive}
            />
          ))}
        </div>
      )}

      <AddMechanicDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => mutate()}
      />
    </div>
  );
}
