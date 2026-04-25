import { useState } from "react";
import { authFetch } from "@/lib/fetcher";
import type { OrderItem } from "@/lib/types";

export type OrderContactPatch = {
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_address: string;
};

export function useOrderMutations(
  orderId: number | string,
  revalidate: () => void,
) {
  const [transitioning, setTransitioning] = useState(false);
  const [savingItems, setSavingItems] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  async function transitionStatus(
    newStatus: string,
    cancellationReason?: string,
  ): Promise<void> {
    setTransitioning(true);
    try {
      await authFetch(`/api/admin/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus, cancellationReason }),
      });
      revalidate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update status");
      throw e;
    } finally {
      setTransitioning(false);
    }
  }

  async function saveItems(items: OrderItem[], notes: string): Promise<void> {
    setSavingItems(true);
    try {
      await authFetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ items, notes }),
      });
      revalidate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save items");
      throw e;
    } finally {
      setSavingItems(false);
    }
  }

  async function saveCustomer(patch: OrderContactPatch): Promise<void> {
    setSavingCustomer(true);
    try {
      await authFetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      revalidate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save contact info");
      throw e;
    } finally {
      setSavingCustomer(false);
    }
  }

  async function setSchedule(
    scheduledAt: string,
    durationMinutes: number,
    location?: string | null,
  ): Promise<void> {
    setSavingSchedule(true);
    try {
      await authFetch(`/api/admin/orders/${orderId}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledAt, durationMinutes, location }),
      });
      revalidate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to set appointment time");
      throw e;
    } finally {
      setSavingSchedule(false);
    }
  }

  return {
    transitionStatus,
    saveItems,
    saveCustomer,
    setSchedule,
    transitioning,
    savingItems,
    savingCustomer,
    savingSchedule,
  };
}
