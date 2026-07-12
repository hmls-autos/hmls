import type { Customer, Order, OrderDetail } from "@hmls/shared/db/types";
import useSWR from "swr";
import { useApi } from "@/hooks/useApi";
import { adminPaths } from "@/lib/api-paths";
import { useStableArray } from "@/lib/swr-stable";

export type { Customer };

interface DashboardStats {
  customers: number;
  orders: number;
  pendingReview: number;
  pendingApprovals: number;
  activeJobs: number;
  todayJobs: number;
  revenue30d: number;
  revenuePrev30d: number;
}

interface UpcomingOrderRow {
  id: number;
  /** Serialized as ISO string over the wire despite Date on gateway side. */
  scheduledAt: string | null;
  contactName: string | null;
  vehicleInfo: { make?: string; model?: string; year?: string } | null;
  status: string;
}

/** Canonical pipeline counts, keyed by the 5 linear lifecycle states. */
export interface DashboardFunnel {
  draft: number;
  estimated: number;
  approved: number;
  in_progress: number;
  completed: number;
}

interface DashboardData {
  stats: DashboardStats;
  funnel: DashboardFunnel;
  /** Weekly completed-order revenue (cents), oldest → newest, fixed length. */
  revenueTrend: number[];
  upcomingOrders: UpcomingOrderRow[];
  recentCustomers: Customer[];
}

export type AdminOrder = Order;

interface CustomerDetail {
  customer: Customer;
  orders: Order[];
}

export function useAdminDashboard() {
  const api = useApi();
  const { data, error, isLoading } = useSWR(
    adminPaths.dashboard(),
    (p: string) => api.get<DashboardData>(p),
  );
  return { data, isLoading, isError: !!error };
}

export function useAdminCustomers(search?: string, enabled = true) {
  const api = useApi();
  const key = enabled ? adminPaths.customers(search) : null;
  const { data, error, isLoading, mutate } = useSWR(key, (p: string) =>
    api.get<Customer[]>(p),
  );
  return {
    customers: useStableArray(data),
    isLoading,
    isError: !!error,
    mutate,
  };
}

export function useAdminCustomer(id: number | null) {
  const api = useApi();
  const path = id != null ? adminPaths.customer(id) : null;
  const { data, error, isLoading, mutate } = useSWR(path, (p: string) =>
    api.get<CustomerDetail>(p),
  );
  return { data, isLoading, isError: !!error, mutate };
}

export function useAdminOrder(id: number | string | null) {
  const api = useApi();
  const path = id != null ? adminPaths.order(id) : null;
  const { data, error, isLoading, mutate } = useSWR(path, (p: string) =>
    api.get<OrderDetail>(p),
  );
  return { data, isLoading, isError: !!error, mutate };
}

export function useAdminOrders(status?: string, search?: string) {
  const api = useApi();
  const { data, error, isLoading, mutate } = useSWR(
    adminPaths.orders({ status, search }),
    (p: string) => api.get<AdminOrder[]>(p),
  );
  return { orders: useStableArray(data), isLoading, isError: !!error, mutate };
}
