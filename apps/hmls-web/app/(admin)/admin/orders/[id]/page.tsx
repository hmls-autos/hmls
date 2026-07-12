"use client";

import {
  type EditableSection,
  STATUS_PROFILES,
} from "@hmls/shared/order/profiles";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { OrderProgressBar } from "@/components/OrderProgressBar";
import { ActivityTimeline } from "@/components/order/ActivityTimeline";
import { DraftBanner } from "@/components/order/DraftBanner";
import { OrderChatPanel } from "@/components/order/OrderChatPanel";
import { OrderOpsPanel } from "@/components/order/OrderOpsPanel";
import { CustomerSection } from "@/components/order/sections/CustomerSection";
import { DiagnosisSection } from "@/components/order/sections/DiagnosisSection";
import { ItemsSection } from "@/components/order/sections/ItemsSection";
import { NotesSection } from "@/components/order/sections/NotesSection";
import { ScheduleSection } from "@/components/order/sections/ScheduleSection";
import { TechPrepCard } from "@/components/order/TechPrepCard";
import { askAuthorization } from "@/components/ui/AuthorizeDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/ui/DateTime";
import { askReason } from "@/components/ui/ReasonDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminOrder } from "@/hooks/useAdmin";
import {
  getAdminOrdersListHref,
  parseAdminOrdersFilter,
  parseAdminOrdersSearch,
} from "@/lib/admin-order-filters";
import { useActionInvoker } from "@/lib/order-actions";
import {
  canonicalStatus,
  isTentativeBooking,
  orderSubBadge,
  statusDisplay,
} from "@/lib/status-display";
import { cn } from "@/lib/utils";

/** Linear lifecycle states the admin progress bar renders as steps. Off-track
 *  states (cancelled/declined) and unknown values need their own title badge. */
const LINEAR_STATUSES = new Set([
  "draft",
  "estimated",
  "approved",
  "in_progress",
  "completed",
]);

/* ── Status Badge (using shadcn Badge) ─────────────────────────────── */

function OrderStatusBadge({
  status,
  config,
  entry,
}: {
  status?: string;
  config?: Record<string, { label: string; color: string }>;
  entry?: { label: string; color: string };
}) {
  const resolved = entry ??
    (status != null ? config?.[status] : undefined) ?? {
      label: status ?? "—",
      color: "bg-neutral-100 text-neutral-500",
    };
  return (
    <Badge variant="outline" className={cn("border-0", resolved.color)}>
      {resolved.label}
    </Badge>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ordersHref = getAdminOrdersListHref(
    parseAdminOrdersFilter(searchParams.get("fromStatus")),
    parseAdminOrdersSearch(searchParams.get("search")),
  );
  const orderId = params.id as string;
  const { data, isLoading, isError, mutate } = useAdminOrder(orderId);

  // Hooks must run before any early return.
  const orderItems = data?.order.items ?? [];
  const suggestedDurationMinutes = useMemo(
    () =>
      Math.max(
        60,
        Math.round(
          orderItems
            .filter((it) => it.category === "labor")
            .reduce((sum, it) => sum + (it.laborHours ?? 0) * 60, 0),
        ) || 60,
      ),
    [orderItems],
  );

  // `useActionInvoker` is a hook — must run unconditionally before any early
  // return. It tolerates `order: null` during load; no action surface is
  // mounted until data resolves.
  const invoker = useActionInvoker(
    data?.order ?? null,
    orderId,
    mutate,
    askReason,
    askAuthorization,
  );

  if (isLoading) {
    return (
      <div className="space-y-6 py-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-12" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-60 w-full rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data?.order) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Order not found.</p>
        <Link
          href={ordersHref}
          className="text-primary text-sm hover:underline mt-2 inline-block"
        >
          Back to orders
        </Link>
      </div>
    );
  }

  const { order } = data;
  const tentative = isTentativeBooking(order);
  const adminStatus = statusDisplay(order.status, "admin", {
    tentativeBooking: tentative,
  });
  // Derived dual-semantics badge: draft → Pending review / Revising · rev N,
  // approved → Pending schedule / Scheduled.
  const subBadge = orderSubBadge(order);
  // The progress bar already names the linear state (draft…completed), so the
  // title only carries the main status text for states the bar can't show: the
  // branches (cancelled / declined) AND any unknown/corrupt value (canonical
  // === null), which the bar would otherwise render as a false "Draft". The
  // sub-badge (Scheduled / Pending review …) always shows.
  const canonical = canonicalStatus(order.status);
  const showMainBadge = !canonical || !LINEAR_STATUSES.has(canonical);

  const v = order.vehicleInfo;
  const vehicleLabel = v
    ? [v.year, v.make, v.model].filter(Boolean).join(" ")
    : "";
  const eventCount = data.events?.length ?? 0;

  // Per-status edit affordances (which sections are editable in this state).
  const profile = canonical ? STATUS_PROFILES[canonical] : null;
  const canEdit = (s: EditableSection) =>
    profile?.editableSections.includes(s) ?? false;

  return (
    <div className="space-y-6">
      {/* Breadcrumb + back */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => router.push(ordersHref)}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Orders
        </Button>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs text-foreground font-medium">#{order.id}</span>
      </div>

      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-display font-semibold tracking-tight text-foreground">
            Order #{order.id}
          </h1>
          {vehicleLabel && (
            <span className="text-lg text-muted-foreground font-medium">
              · {vehicleLabel}
            </span>
          )}
          {showMainBadge && <OrderStatusBadge entry={adminStatus} />}
          {subBadge ? (
            <OrderStatusBadge entry={subBadge} />
          ) : (
            order.revisionNumber > 1 && (
              <Badge variant="secondary" className="text-[10px]">
                v{order.revisionNumber}
              </Badge>
            )
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          Created <DateTime value={order.createdAt} format="datetime" />
          {" · Updated "}
          <DateTime value={order.updatedAt} format="datetime" />
        </span>
      </div>

      {canonicalStatus(order.status) === "draft" && (
        <DraftBanner order={order} invoker={invoker} />
      )}

      {/* Progress bar */}
      <Card className="py-4 gap-0 border-0">
        <CardContent>
          <OrderProgressBar
            status={order.status}
            variant="admin"
            tentativeBooking={tentative}
          />
        </CardContent>
      </Card>

      {/* Content grid — tabbed main area + a persistent Actions sidebar so the
          operator can act from any tab without losing the working view. The
          two tall, lower-frequency panels (Activity, Chat) live behind tabs so
          the Overview tab stays a single scannable screen. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">
                Activity{eventCount > 0 ? ` (${eventCount})` : ""}
              </TabsTrigger>
              <TabsTrigger value="chat">Assistant</TabsTrigger>
            </TabsList>

            {/* Overview — the working view. Line items carries the total +
                PDF (the old standalone Estimate card folded in); the booking
                logistics (Appointment + Customer) sit side by side so the page
                reads as a few dense blocks, not a tall stack of one-fact cards. */}
            <TabsContent value="overview" className="space-y-4">
              <ItemsSection
                order={order}
                readOnly={!canEdit("items")}
                revalidate={mutate}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <ScheduleSection
                  order={order}
                  readOnly={!canEdit("schedule")}
                  revalidate={mutate}
                  onSetTime={() => invoker.openDialog("set_time")}
                  onReassign={() => invoker.openDialog("reassign")}
                />
                <CustomerSection
                  order={order}
                  readOnly={!canEdit("customer")}
                  revalidate={mutate}
                  profilePreferred={data.customer?.preferredContact ?? null}
                />
              </div>
              <DiagnosisSection
                order={order}
                readOnly={!canEdit("diagnosis")}
                revalidate={mutate}
              />
              <TechPrepCard order={order} />
              <NotesSection order={order} />
              {order.cancellationReason && (
                <Card className="gap-0 py-0 border-0">
                  <CardHeader className="px-4 py-4">
                    <CardTitle className="text-sm text-destructive">
                      Cancellation Reason
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-xs text-foreground">
                      {order.cancellationReason}
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="activity">
              <Card className="gap-0 py-0 border-0">
                <CardHeader className="px-4 py-4">
                  <CardTitle className="text-sm">Activity</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <ActivityTimeline events={data.events ?? []} />
                </CardContent>
              </Card>
            </TabsContent>

            {/* forceMount keeps the chat — and any in-flight agent turn (assign
                mechanic / send estimate) plus its onFinish revalidate — alive
                when the operator switches tabs mid-stream. Radix unmounts an
                inactive TabsContent by default, which would abort the turn. */}
            <TabsContent
              value="chat"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              {/* Agent tool mutations revalidate the page via SWR mutate. */}
              <OrderChatPanel
                orderId={order.id}
                revalidate={mutate}
                defaultOpen
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Persistent action rail — visible on every tab. */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <OrderOpsPanel
            order={order}
            invoker={invoker}
            revalidate={mutate}
            suggestedDurationMinutes={suggestedDurationMinutes}
          />
        </aside>
      </div>
    </div>
  );
}
