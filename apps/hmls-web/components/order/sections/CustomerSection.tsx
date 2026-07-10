"use client";

import { useState } from "react";
import { CustomerEditor } from "@/components/order/CustomerEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrderMutations } from "@/hooks/useOrderMutations";
import type { SectionProps } from "./types";

const PREFERRED_LABEL = {
  text: "📱 Prefers: Text",
  call: "📞 Prefers: Call",
  email: "✉️ Prefers: Email",
} as const;

export function CustomerSection({
  order,
  readOnly,
  revalidate,
  profilePreferred,
}: SectionProps & { profilePreferred?: "text" | "call" | "email" | null }) {
  const [editing, setEditing] = useState(false);
  // Order snapshot wins (per-order intent); fall back to the customer's
  // stable profile default so manual/legacy orders still show a badge.
  const preferred = order.contactPreferred ?? profilePreferred ?? null;
  const { saveCustomer, savingCustomer, logContact, loggingContact } =
    useOrderMutations(order.id, revalidate);

  if (editing && !readOnly) {
    return (
      <Card className="gap-0 py-0">
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
    <Card className="gap-0 py-0">
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
          <p className="pt-1 font-medium text-foreground">
            {PREFERRED_LABEL[preferred]}
          </p>
        )}
        {/* Outreach happens in every status (chasing an estimated quote,
            confirming a scheduled visit) — logging it is never read-only. */}
        <div className="flex items-center gap-1 pt-2">
          <span className="text-muted-foreground">Log contact:</span>
          {(["text", "call", "email"] as const).map((method) => (
            <Button
              key={method}
              variant="ghost"
              size="xs"
              disabled={loggingContact}
              onClick={() => logContact(method)}
            >
              {method === "text"
                ? "Texted"
                : method === "call"
                  ? "Called"
                  : "Emailed"}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
