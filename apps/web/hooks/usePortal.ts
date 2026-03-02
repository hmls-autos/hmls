import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { Booking, Estimate, Order, Quote } from "@/lib/types";

export interface PortalCustomer {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  vehicleInfo: { make?: string; model?: string; year?: string } | null;
  stripeCustomerId: string | null;
  createdAt: string;
}

export type PortalOrder = Order;

export function usePortalCustomer() {
  const { data, error, isLoading, mutate } = useSWR<PortalCustomer>(
    "/api/portal/me",
    fetcher,
  );
  return { customer: data, isLoading, isError: !!error, mutate };
}

export function usePortalBookings() {
  const { data, error, isLoading } = useSWR<Booking[]>(
    "/api/portal/me/bookings",
    fetcher,
  );
  return { bookings: data ?? [], isLoading, isError: !!error };
}

export function usePortalEstimates() {
  const { data, error, isLoading } = useSWR<Estimate[]>(
    "/api/portal/me/estimates",
    fetcher,
  );
  return { estimates: data ?? [], isLoading, isError: !!error };
}

export function usePortalOrders() {
  const { data, error, isLoading, mutate } = useSWR<PortalOrder[]>(
    "/api/portal/me/orders",
    fetcher,
  );
  return { orders: data ?? [], isLoading, isError: !!error, mutate };
}

export function usePortalQuotes() {
  const { data, error, isLoading } = useSWR<Quote[]>(
    "/api/portal/me/quotes",
    fetcher,
  );
  return { quotes: data ?? [], isLoading, isError: !!error };
}
