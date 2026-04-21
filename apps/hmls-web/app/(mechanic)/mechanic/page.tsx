"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type MechanicOrder, useMechanicOrders } from "@/hooks/useMechanic";
import { formatDate, formatTime } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

function vehicleLabel(o: MechanicOrder) {
  const v = o.vehicleInfo;
  if (!v) return null;
  return [v.year, v.make, v.model].filter(Boolean).join(" ");
}

function groupByDay(orders: MechanicOrder[]) {
  const map = new Map<string, MechanicOrder[]>();
  for (const o of orders) {
    if (!o.scheduledAt) continue;
    const key = new Date(o.scheduledAt).toDateString();
    const existing = map.get(key);
    if (existing) existing.push(o);
    else map.set(key, [o]);
  }
  for (const [key, group] of map) {
    map.set(
      key,
      group.sort((a, b) => {
        const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
        const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
        return ta - tb;
      }),
    );
  }
  return map;
}

function OrderCard({ order }: { order: MechanicOrder }) {
  const vehicle = vehicleLabel(order);
  const time = order.scheduledAt ? formatTime(order.scheduledAt) : "—";
  const statusConfig = ORDER_STATUS[order.status] ?? {
    label: order.status,
    color: "bg-neutral-100 text-neutral-500",
  };
  const firstItem = order.items?.[0]?.name ?? "Service";

  return (
    <Card className="py-0">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="shrink-0 text-center sm:w-16">
          <span className="text-xs font-semibold text-muted-foreground bg-muted border border-border rounded-lg px-2 py-1 inline-block">
            {time}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-foreground">
              #{order.id}
            </span>
            <Badge className={cn("border-transparent", statusConfig.color)}>
              {statusConfig.label}
            </Badge>
          </div>
          <p className="text-sm text-foreground truncate">
            {order.contactName ?? "Customer"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{firstItem}</p>
          {vehicle && (
            <p className="text-xs text-muted-foreground">{vehicle}</p>
          )}
          {order.location && (
            <p className="text-xs text-muted-foreground truncate">
              {order.location}
            </p>
          )}
          {order.customerNotes && (
            <p className="text-xs text-muted-foreground mt-1 italic truncate">
              &ldquo;{order.customerNotes}&rdquo;
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MechanicOrdersPage() {
  const fromDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const { orders, isLoading } = useMechanicOrders(fromDate);

  const upcoming = orders.filter((o) =>
    ["scheduled", "in_progress"].includes(o.status),
  );
  const byDay = groupByDay(upcoming);
  const sortedDays = [...byDay.keys()].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );

  if (isLoading) {
    return (
      <div className="space-y-10">
        <Skeleton className="h-8 w-40" />
        <div className="space-y-2">
          {["s1", "s2", "s3"].map((id) => (
            <Skeleton key={id} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-display font-bold text-foreground">
        My Jobs
      </h1>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No upcoming jobs assigned.
          </p>
        ) : (
          <div className="space-y-6">
            {sortedDays.map((day) => (
              <div key={day}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {formatDate(new Date(day).toISOString())}
                </h3>
                <div className="space-y-2">
                  {byDay.get(day)?.map((o) => (
                    <OrderCard key={o.id} order={o} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
