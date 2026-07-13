"use client";

import { EstimateCard, type EstimateCardData } from "@/components/EstimateCard";

export interface CreateOrderOutput {
  success: boolean;
  orderId?: number;
  vehicle?: string;
  items?: Array<{ name: string; description?: string; totalCents: number }>;
  subtotal?: number;
  priceRange?: string | null;
  expiresAt?: string | null;
  downloadUrl?: string;
  shareUrl?: string | null;
  pendingReview?: boolean;
  status?: string;
  note?: string;
}

/** Renders an EstimateCard inline from the `create_order` tool output. Maps
 * cents → dollars and tolerates the slightly looser shape the agent emits.
 *
 * `mode` decides where the "open order" action links to — customer chat
 * jumps into the portal, staff chat jumps into the admin order page. */
export function EstimateCardInline({
  output,
  mode = "staff",
}: {
  output: CreateOrderOutput;
  mode?: "customer" | "staff";
}) {
  if (!output?.success) return null;

  const data: EstimateCardData = {
    success: true,
    orderId: output.orderId,
    status: output.status,
    pendingReview: output.pendingReview,
    vehicle: output.vehicle ?? "Unknown vehicle",
    items: (output.items ?? []).map((i) => ({
      name: i.name,
      description: i.description,
      price: typeof i.totalCents === "number" ? i.totalCents / 100 : 0,
    })),
    subtotal: typeof output.subtotal === "number" ? output.subtotal : 0,
    priceRange: output.priceRange ?? "",
    expiresAt: output.expiresAt ?? undefined,
    shareUrl: output.shareUrl ?? undefined,
    downloadUrl: output.downloadUrl,
    note: output.note,
  };

  const accountLink = output.orderId
    ? mode === "customer"
      ? {
          href: `/portal/orders/${output.orderId}`,
          label: "View in your account",
        }
      : { href: `/admin/orders/${output.orderId}`, label: "Open order" }
    : undefined;

  return <EstimateCard data={data} accountLink={accountLink} />;
}
