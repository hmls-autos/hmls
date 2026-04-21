import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { Customer, Order, OrderDetail } from "@/lib/types";

export type PortalCustomer = Customer;
export type PortalOrder = Order;

export function usePortalCustomer() {
  const { data, error, isLoading, mutate } = useSWR<PortalCustomer>(
    "/api/portal/me",
    fetcher,
  );
  return { customer: data, isLoading, isError: !!error, mutate };
}

export function usePortalOrders() {
  const { data, error, isLoading, mutate } = useSWR<PortalOrder[]>(
    "/api/portal/me/orders",
    fetcher,
  );
  return { orders: data ?? [], isLoading, isError: !!error, mutate };
}

export function usePortalOrder(id: string | number | null) {
  const { data, error, isLoading, mutate } = useSWR<OrderDetail>(
    id ? `/api/portal/me/orders/${id}` : null,
    fetcher,
  );
  return { data, isLoading, isError: !!error, mutate };
}

/**
 * Bookings view = orders with scheduledAt set. The server filters server-side.
 */
export function usePortalBookings() {
  const { data, error, isLoading, mutate } = useSWR<PortalOrder[]>(
    "/api/portal/me/bookings",
    fetcher,
  );
  return { bookings: data ?? [], isLoading, isError: !!error, mutate };
}
