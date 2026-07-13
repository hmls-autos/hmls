import type {
  Customer,
  CustomerOrderEvent,
  Order,
  OrderIntake,
} from "@hmls/shared/db/types";
import useSWR from "swr";
import { useApi } from "@/hooks/useApi";
import { portalPaths } from "@/lib/api-paths";
import { useStableArray } from "@/lib/swr-stable";

export type PortalCustomer = Customer;
export type PortalOrder = Order;

/** Shape returned by GET /api/portal/me/orders/:id — order + intake + events
 *  (no customer join; portal route is customer-scoped). Events are the
 *  customer-visible projection: allowlisted types, no metadata/actor. */
export type PortalOrderDetail = {
  order: Order;
  intake: OrderIntake | null;
  events: CustomerOrderEvent[];
  needsAddress: boolean;
};

export function usePortalCustomer() {
  const api = useApi();
  const { data, error, isLoading, mutate } = useSWR(
    portalPaths.me(),
    (p: string) => api.get<PortalCustomer>(p),
  );
  return { customer: data, isLoading, isError: !!error, mutate };
}

export function usePortalOrders() {
  const api = useApi();
  const { data, error, isLoading, mutate } = useSWR(
    portalPaths.orders(),
    (p: string) => api.get<PortalOrder[]>(p),
  );
  return { orders: useStableArray(data), isLoading, isError: !!error, mutate };
}

export function usePortalOrder(id: string | number | null) {
  const api = useApi();
  const path = id != null ? portalPaths.order(id) : null;
  const { data, error, isLoading, mutate } = useSWR(path, (p: string) =>
    api.get<PortalOrderDetail>(p),
  );
  return { data, isLoading, isError: !!error, mutate };
}
