import { canonicalStatus } from "@/lib/status-display";

// The 7 canonical states plus the 'active' virtual filter (approved ∪
// in_progress — the gateway only understands single statuses, so 'active'
// fetches unfiltered and narrows client-side via applyVirtualOrderFilters).
// Legacy 'scheduled'/'revised' filter URLs fall back to "All" — the
// gateway's ?status=approved / ?status=draft responses already include
// window-period legacy rows, so nothing is hidden.
const ADMIN_ORDER_FILTERS = [
  "draft",
  "estimated",
  "approved",
  "in_progress",
  "completed",
  "declined",
  "cancelled",
  "active",
] as const;

export type AdminOrdersFilter = "" | (typeof ADMIN_ORDER_FILTERS)[number];

const ADMIN_ORDER_FILTER_SET = new Set<string>(ADMIN_ORDER_FILTERS);

export function parseAdminOrdersFilter(
  value: string | null | undefined,
): AdminOrdersFilter {
  return value && ADMIN_ORDER_FILTER_SET.has(value)
    ? (value as AdminOrdersFilter)
    : "";
}

export function parseAdminOrdersSearch(
  value: string | null | undefined,
): string {
  return value?.trim() ?? "";
}

export function parseAdminOrdersToday(
  value: string | null | undefined,
): boolean {
  return value === "1";
}

/** Client-side narrowing for the virtual filters. `now` injectable for tests. */
export function applyVirtualOrderFilters<
  T extends { status: string; scheduledAt: string | Date | null },
>(rows: T[], filter: AdminOrdersFilter, today: boolean, now = new Date()): T[] {
  let out = rows;
  if (filter === "active") {
    out = out.filter((r) => {
      const s = canonicalStatus(r.status);
      return s === "approved" || s === "in_progress";
    });
  }
  if (today) {
    out = out.filter((r) => {
      if (!r.scheduledAt) return false;
      const d = new Date(r.scheduledAt);
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    });
  }
  return out;
}

function buildOrdersQuery(
  filter: AdminOrdersFilter,
  search?: string,
  filterParam: "status" | "fromStatus" = "status",
  today?: boolean,
): string {
  const qs = new URLSearchParams();
  if (filter) qs.set(filterParam, filter);
  const trimmedSearch = search?.trim();
  if (trimmedSearch) qs.set("search", trimmedSearch);
  if (today) qs.set("today", "1");
  return qs.toString();
}

export function getAdminOrdersListHref(
  filter: AdminOrdersFilter,
  search?: string,
  opts?: { today?: boolean },
): string {
  const qs = buildOrdersQuery(filter, search, "status", opts?.today);
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}

export function getAdminOrderDetailHref(
  orderId: number | string,
  filter: AdminOrdersFilter,
  search?: string,
): string {
  const qs = buildOrdersQuery(filter, search, "fromStatus");
  const baseHref = `/admin/orders/${orderId}`;
  return qs ? `${baseHref}?${qs}` : baseHref;
}
