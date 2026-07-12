"use client";

import {
  AlertTriangle,
  CalendarClock,
  Clock,
  PlayCircle,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { DateTime } from "@/components/ui/DateTime";
import { Skeleton } from "@/components/ui/skeleton";
import { type DashboardFunnel, useAdminDashboard } from "@/hooks/useAdmin";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

/* No cards, no borders. Structure comes from section labels, whitespace, and
 * the marks themselves. The only filled surfaces are the action tiles (they're
 * clickable CTAs); a single red accent carries urgency. */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider font-mono text-muted-foreground">
      {children}
    </h2>
  );
}

/* ── Action queue ─────────────────────────────────────────────────────────── */

function ActionTile({
  label,
  value,
  sub,
  icon: Icon,
  href,
  urgent,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  urgent?: boolean;
}) {
  const on = urgent && value > 0;
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-xl p-4 transition-colors",
        on
          ? "bg-red-500/10 hover:bg-red-500/15"
          : "bg-muted/40 hover:bg-muted/70",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-sm",
            on ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <Icon
          className={cn(
            "w-4 h-4 shrink-0",
            on ? "text-red-500 dark:text-red-400" : "text-muted-foreground",
          )}
        />
      </div>
      <p
        className={cn(
          "text-3xl font-display font-semibold mt-2 tabular-nums",
          on ? "text-red-600 dark:text-red-400" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "text-xs mt-0.5",
          on ? "text-red-600/80 dark:text-red-400/80" : "text-muted-foreground",
        )}
      >
        {sub}
      </p>
    </Link>
  );
}

/* ── Order pipeline funnel ─────────────────────────────────────────────────
 * Bars for the four in-flight states (completed dwarfs them, so it's a footer
 * stat instead of a bar). Draft is red — it's the state stuck on the shop. */

const FUNNEL_ROWS: {
  key: keyof Pick<
    DashboardFunnel,
    "draft" | "estimated" | "approved" | "in_progress"
  >;
  label: string;
  href: string;
}[] = [
  { key: "draft", label: "Draft", href: "/admin/orders?status=draft" },
  {
    key: "estimated",
    label: "Estimated",
    href: "/admin/orders?status=estimated",
  },
  { key: "approved", label: "Approved", href: "/admin/orders?status=approved" },
  {
    key: "in_progress",
    label: "In progress",
    href: "/admin/orders?status=in_progress",
  },
];

function FunnelChart({ funnel }: { funnel: DashboardFunnel }) {
  const active = FUNNEL_ROWS.map((r) => funnel[r.key]);
  const max = Math.max(...active, 1);
  const total =
    funnel.draft +
    funnel.estimated +
    funnel.approved +
    funnel.in_progress +
    funnel.completed;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <SectionLabel>Order pipeline</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {total} total
        </span>
      </div>
      <div className="flex flex-col gap-3.5">
        {FUNNEL_ROWS.map((r) => {
          const value = funnel[r.key];
          const pct = Math.round((value / max) * 100);
          return (
            <Link key={r.key} href={r.href} className="block group">
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                  {r.label}
                </span>
                <span className="text-foreground tabular-nums">{value}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full",
                    r.key === "draft" ? "bg-red-500" : "bg-foreground/40",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </Link>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground tabular-nums">
        {funnel.completed} completed
      </p>
    </div>
  );
}

/* ── Revenue trend ─────────────────────────────────────────────────────────
 * Hand-rolled SVG area line (8 weekly points). One accent stroke, non-scaling
 * so it stays crisp when the viewBox stretches to fill width. */

function RevenueSparkline({ data }: { data: number[] }) {
  const w = 300;
  const h = 72;
  const pad = 6;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-20"
      preserveAspectRatio="none"
      role="img"
      aria-label="Weekly revenue trend over the last 8 weeks"
    >
      <defs>
        <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--red-primary)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--red-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#revenueGradient)" />
      <path
        d={line}
        fill="none"
        stroke="var(--red-primary)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function RevenueCard({
  revenue30d,
  revenuePrev30d,
  trend,
}: {
  revenue30d: number;
  revenuePrev30d: number;
  trend: number[];
}) {
  const deltaPct =
    revenuePrev30d > 0
      ? Math.round(((revenue30d - revenuePrev30d) / revenuePrev30d) * 100)
      : null;
  const DeltaIcon =
    deltaPct != null && deltaPct < 0 ? TrendingDown : TrendingUp;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <SectionLabel>Revenue</SectionLabel>
        <span className="text-xs text-muted-foreground">last 30 days</span>
      </div>
      <div className="flex items-baseline gap-2">
        <p className="text-3xl font-display font-semibold text-foreground tabular-nums">
          {formatCents(revenue30d)}
        </p>
        {deltaPct != null && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <DeltaIcon className="w-3 h-3" />
            {Math.abs(deltaPct)}%
          </span>
        )}
      </div>
      <div className="mt-4">
        <RevenueSparkline data={trend} />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>8 weeks ago</span>
          <span>this week</span>
        </div>
      </div>
    </div>
  );
}

/* ── List sections ─────────────────────────────────────────────────────────
 * Flat rows separated by hairlines — no outer box. */

function ListSection({
  title,
  href,
  empty,
  children,
}: {
  title: string;
  href: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>{title}</SectionLabel>
        <Link
          href={href}
          className="text-xs text-primary hover:text-primary/80 font-medium"
        >
          View all
        </Link>
      </div>
      {empty ? (
        <p className="text-xs text-muted-foreground py-4">Nothing here yet.</p>
      ) : (
        <div className="divide-y divide-border">{children}</div>
      )}
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      <div>
        <Skeleton className="h-8 w-40 mb-1" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {["t1", "t2", "t3", "t4"].map((id) => (
          <Skeleton key={id} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function AdminDashboard() {
  const { data, isLoading } = useAdminDashboard();

  if (isLoading || !data) {
    return <DashboardSkeleton />;
  }

  const { stats, funnel, revenueTrend, upcomingOrders, recentCustomers } = data;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-display font-semibold tracking-tight text-foreground mb-1">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Business overview at a glance.
        </p>
      </div>

      {/* Needs your attention — operational triage */}
      <section className="space-y-3">
        <SectionLabel>Needs your attention</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <ActionTile
            label="Pending review"
            value={stats.pendingReview}
            sub="AI drafts to send"
            icon={AlertTriangle}
            href="/admin/orders?status=draft"
            urgent
          />
          <ActionTile
            label="Awaiting approval"
            value={stats.pendingApprovals}
            sub="Sent, waiting on customer"
            icon={Clock}
            href="/admin/orders?status=estimated"
          />
          <ActionTile
            label="Today's jobs"
            value={stats.todayJobs}
            sub="Scheduled for today"
            icon={CalendarClock}
            href="/admin/orders?status=approved"
          />
          <ActionTile
            label="Active jobs"
            value={stats.activeJobs}
            sub="Booked or in progress"
            icon={PlayCircle}
            href="/admin/orders?status=in_progress"
          />
        </div>
      </section>

      {/* Pipeline + revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <FunnelChart funnel={funnel} />
        <RevenueCard
          revenue30d={stats.revenue30d}
          revenuePrev30d={stats.revenuePrev30d}
          trend={revenueTrend}
        />
      </div>

      {/* Upcoming bookings + recent customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <ListSection
          title="Upcoming bookings"
          href="/admin/orders?status=approved"
          empty={upcomingOrders.length === 0}
        >
          {upcomingOrders.map((o) => {
            const v = o.vehicleInfo;
            const vehicleStr = v
              ? [v.year, v.make, v.model].filter(Boolean).join(" ")
              : null;
            return (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="block py-3 -mx-2 px-2 rounded-lg hover:bg-muted/60 transition-colors"
              >
                <p className="text-sm text-foreground font-medium truncate">
                  #{o.id}
                  {vehicleStr ? ` · ${vehicleStr}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  <DateTime value={o.scheduledAt} format="date" /> &middot;{" "}
                  {o.contactName ?? "Unknown"}
                </p>
              </Link>
            );
          })}
        </ListSection>

        <ListSection
          title="Recent customers"
          href="/admin/customers"
          empty={recentCustomers.length === 0}
        >
          {recentCustomers.map((cust) => (
            <Link
              key={cust.id}
              href={`/admin/customers?id=${cust.id}`}
              className="block py-3 -mx-2 px-2 rounded-lg hover:bg-muted/60 transition-colors"
            >
              <p className="text-sm text-foreground font-medium truncate">
                {cust.name ?? "Unnamed"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {cust.email ?? cust.phone ?? "No contact info"}
              </p>
            </Link>
          ))}
        </ListSection>
      </div>
    </div>
  );
}
