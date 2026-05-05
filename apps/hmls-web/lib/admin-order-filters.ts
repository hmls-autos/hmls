const ADMIN_ORDER_FILTERS = [
  "draft",
  "estimated",
  "approved",
  "scheduled",
  "in_progress",
  "completed",
  "declined",
  "revised",
  "cancelled",
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

export function getAdminOrdersListHref(filter: AdminOrdersFilter): string {
  return filter
    ? `/admin/orders?status=${encodeURIComponent(filter)}`
    : "/admin/orders";
}

export function getAdminOrderDetailHref(
  orderId: number | string,
  filter: AdminOrdersFilter,
): string {
  const baseHref = `/admin/orders/${orderId}`;
  return filter
    ? `${baseHref}?fromStatus=${encodeURIComponent(filter)}`
    : baseHref;
}
