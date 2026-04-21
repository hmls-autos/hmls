import useSWR from "swr";
import { authFetch, fetcher } from "@/lib/fetcher";
import type { Order } from "@/lib/types";

export interface Mechanic {
  id: number;
  authUserId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  specialties: unknown;
  isActive: boolean;
  serviceRadiusMiles: number | null;
  homeBaseLat: string | null;
  homeBaseLng: string | null;
  timezone: string;
  createdAt: string;
}

export interface MechanicListRow extends Mechanic {
  weekUtilization: number | null;
  isOnJobNow: boolean;
  upcomingBookingsCount: number;
  earnings30d: number;
  nextBookingAt: string | null;
}

export interface WeeklyRow {
  id: number;
  providerId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface ScheduleOverride {
  id: number;
  providerId: number;
  overrideDate: string;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export type MechanicOrderRow = Order & {
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
};

export function useAdminMechanics() {
  const { data, error, isLoading, mutate } = useSWR<MechanicListRow[]>(
    "/api/admin/mechanics",
    fetcher,
  );

  async function createMechanic(payload: {
    name: string;
    email?: string;
    phone?: string;
    timezone?: string;
    serviceRadiusMiles?: number;
    homeBaseLat?: number | null;
    homeBaseLng?: number | null;
    specialties?: string[];
  }) {
    const created = await authFetch<Mechanic>("/api/admin/mechanics", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await mutate();
    return created;
  }

  return {
    mechanics: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
    createMechanic,
  };
}

export function useAdminMechanic(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<Mechanic>(
    id ? `/api/admin/mechanics/${id}` : null,
    fetcher,
  );

  async function updateMechanic(patch: Partial<Mechanic>) {
    if (!id) throw new Error("No mechanic id");
    await authFetch(`/api/admin/mechanics/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await mutate();
  }

  async function deactivate() {
    if (!id) throw new Error("No mechanic id");
    await authFetch(`/api/admin/mechanics/${id}`, { method: "DELETE" });
    await mutate();
  }

  return {
    mechanic: data,
    isLoading,
    isError: !!error,
    mutate,
    updateMechanic,
    deactivate,
  };
}

export function useAdminMechanicAvailability(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<WeeklyRow[]>(
    id ? `/api/admin/mechanics/${id}/availability` : null,
    fetcher,
  );

  async function saveAvailability(
    rows: Array<Pick<WeeklyRow, "dayOfWeek" | "startTime" | "endTime">>,
  ) {
    if (!id) throw new Error("No mechanic id");
    await authFetch(`/api/admin/mechanics/${id}/availability`, {
      method: "PUT",
      body: JSON.stringify({ availability: rows }),
    });
    await mutate();
  }

  return {
    availability: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
    saveAvailability,
  };
}

export function useAdminMechanicOverrides(
  id: number | null,
  from?: string,
  to?: string,
) {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const qs = p.toString() ? `?${p.toString()}` : "";
  const { data, error, isLoading, mutate } = useSWR<ScheduleOverride[]>(
    id ? `/api/admin/mechanics/${id}/overrides${qs}` : null,
    fetcher,
  );

  async function addOverride(payload: {
    overrideDate: string;
    isAvailable: boolean;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }) {
    if (!id) throw new Error("No mechanic id");
    await authFetch(`/api/admin/mechanics/${id}/overrides`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await mutate();
  }

  async function deleteOverride(overrideId: number) {
    if (!id) throw new Error("No mechanic id");
    await authFetch(`/api/admin/mechanics/${id}/overrides/${overrideId}`, {
      method: "DELETE",
    });
    await mutate();
  }

  return {
    overrides: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
    addOverride,
    deleteOverride,
  };
}

export function useAdminMechanicOrders(
  id: number | null,
  from?: string,
  to?: string,
) {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const qs = p.toString() ? `?${p.toString()}` : "";
  const { data, error, isLoading, mutate } = useSWR<MechanicOrderRow[]>(
    id ? `/api/admin/mechanics/${id}/orders${qs}` : null,
    fetcher,
  );

  return {
    orders: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
  };
}

export async function assignMechanic(
  orderId: number,
  providerId: number,
  force = false,
) {
  return await authFetch(`/api/admin/mechanics/orders/${orderId}/assign`, {
    method: "POST",
    body: JSON.stringify({ providerId, force }),
  });
}
