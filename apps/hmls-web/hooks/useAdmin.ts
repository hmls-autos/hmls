import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type {
  Booking,
  Customer,
  Estimate,
  Order,
  OrderDetail,
  Quote,
} from "@/lib/types";

export type { Customer };

interface DashboardStats {
  customers: number;
  bookings: number;
  estimates: number;
  quotes: number;
  revenue30d: number;
}

interface DashboardData {
  stats: DashboardStats;
  upcomingBookings: Booking[];
  recentCustomers: Customer[];
  pendingQuotes: (Quote & {
    customer?: { name: string | null; email: string | null };
  })[];
}

export type AdminBooking = Booking & {
  customer: { name: string | null; email: string | null; phone: string | null };
};

export type AdminEstimate = Estimate & {
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    vehicleInfo: { make?: string; model?: string; year?: string } | null;
  };
  orderId: number | null;
  orderStatus: string | null;
};

export type AdminQuote = Quote & {
  customer: { name: string | null; email: string | null };
};

export type AdminOrder = Order;

interface CustomerDetail {
  customer: Customer;
  bookings: Booking[];
  estimates: Estimate[];
  quotes: Quote[];
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

export function useAdminBookings(status?: string) {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  const { data, error, isLoading, mutate } = useSWR<AdminBooking[]>(
    `/api/admin/bookings${params}`,
    fetcher,
  );
  return { bookings: data ?? [], isLoading, isError: !!error, mutate };
}

export function useAdminEstimates() {
  const { data, error, isLoading, mutate } = useSWR<AdminEstimate[]>(
    "/api/admin/estimates",
    fetcher,
  );
  return { estimates: data ?? [], isLoading, isError: !!error, mutate };
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

export function useAdminQuotes(status?: string) {
  const params = status ? `?status=${encodeURIComponent(status)}` : "";
  const { data, error, isLoading, mutate } = useSWR<AdminQuote[]>(
    `/api/admin/quotes${params}`,
    fetcher,
  );
  return { quotes: data ?? [], isLoading, isError: !!error, mutate };
}
