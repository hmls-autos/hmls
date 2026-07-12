"use client";

import type { ContactMethod } from "@hmls/shared/api/contracts/orders";
import { CONTACT_METHODS } from "@hmls/shared/api/contracts/orders";
import { Mail, Phone, Smartphone } from "lucide-react";
import { useState } from "react";
import { CONTACT_VERB } from "@/components/order/ActivityTimeline";
import { CustomerEditor } from "@/components/order/CustomerEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrderMutations } from "@/hooks/useOrderMutations";
import type { SectionProps } from "./types";

export const PREFERRED_ICON: Record<ContactMethod, typeof Smartphone> = {
  text: Smartphone,
  call: Phone,
  email: Mail,
};

export const PREFERRED_LABEL: Record<ContactMethod, string> = {
  text: "Prefers: Text",
  call: "Prefers: Call",
  email: "Prefers: Email",
};

export function CustomerSection({
  order,
  readOnly,
  revalidate,
  profilePreferred,
}: SectionProps & { profilePreferred?: ContactMethod | null }) {
  const [editing, setEditing] = useState(false);
  // Order snapshot wins (per-order intent); fall back to the customer's
  // stable profile default so manual/legacy orders still show a badge.
  const preferred = order.contactPreferred ?? profilePreferred ?? null;
  const { saveCustomer, savingCustomer, logContact, loggingContact } =
    useOrderMutations(order.id, revalidate);

  if (editing && !readOnly) {
    return (
      <Card className="gap-0 py-0 border-0">
        <CardHeader className="px-4 py-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Customer</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <CustomerEditor
            order={{
              contactName: order.contactName ?? null,
              contactEmail: order.contactEmail ?? null,
              contactPhone: order.contactPhone ?? null,
              contactAddress: order.contactAddress ?? null,
              contactPreferred: order.contactPreferred ?? null,
            }}
            saving={savingCustomer}
            onSave={async (patch) => {
              await saveCustomer(patch);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-0 border-0">
      <CardHeader className="px-4 py-4 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Customer</CardTitle>
        {!readOnly && (
          <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4 text-xs space-y-1">
        <p className="text-foreground">{order.contactName ?? "—"}</p>
        <p className="text-muted-foreground">{order.contactPhone ?? "—"}</p>
        <p className="text-muted-foreground">{order.contactEmail ?? "—"}</p>
        <p className="text-muted-foreground">{order.contactAddress ?? "—"}</p>
        {preferred && (
          <p className="flex items-center gap-1.5 pt-1 font-medium text-foreground">
            {(() => {
              const Icon = PREFERRED_ICON[preferred];
              return <Icon className="w-3.5 h-3.5" />;
            })()}
            {PREFERRED_LABEL[preferred]}
          </p>
        )}
        {/* Outreach happens in every status (chasing an estimated quote,
            confirming a scheduled visit) — logging it is never read-only. */}
        <div className="flex items-center gap-1 pt-2">
          <span className="text-muted-foreground">Log contact:</span>
          {CONTACT_METHODS.map((method) => (
            <Button
              key={method}
              variant="ghost"
              size="xs"
              disabled={loggingContact}
              onClick={() => logContact(method)}
            >
              {CONTACT_VERB[method]}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
