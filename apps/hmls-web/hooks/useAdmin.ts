import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { Customer, Order, OrderDetail } from "@/lib/types";

export type { Customer };

interface DashboardStats {
  customers: number;
  orders: number;
  pendingReview: number;
  pendingApprovals: number;
  activeJobs: number;
  revenue30d: number;
}

interface UpcomingOrderRow {
  id: number;
  scheduledAt: string | null;
  contactName: string | null;
  vehicleInfo: { make?: string; model?: string; year?: string } | null;
  status: string;
}

interface DashboardData {
  stats: DashboardStats;
  upcomingOrders: UpcomingOrderRow[];
  recentCustomers: Customer[];
}

export type AdminOrder = Order;

interface CustomerDetail {
  customer: Customer;
  orders: Order[];
}

export function useAdminDashboard() {
  const { data, error, isLoading } = useSWR<DashboardData>(
    "/api/admin/dashboard",
    fetcher,
  );
  return { data, isLoading, isError: !!error };
}

export function useAdminCustomers(search?: string) {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  const { data, error, isLoading, mutate } = useSWR<Customer[]>(
    `/api/admin/customers${params}`,
    fetcher,
  );
  return { customers: data ?? [], isLoading, isError: !!error, mutate };
}

export function useAdminCustomer(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<CustomerDetail>(
    id ? `/api/admin/customers/${id}` : null,
    fetcher,
  );
  return { data, isLoading, isError: !!error, mutate };
}

export function useAdminOrder(id: number | string | null) {
  const { data, error, isLoading, mutate } = useSWR<OrderDetail>(
    id ? `/api/admin/orders/${id}` : null,
    fetcher,
  );
  return { data, isLoading, isError: !!error, mutate };
}

export function useAdminOrders(status?: string) {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  const { data, error, isLoading, mutate } = useSWR<AdminOrder[]>(
    `/api/admin/orders${params}`,
    fetcher,
  );
  return { orders: data ?? [], isLoading, isError: !!error, mutate };
}
