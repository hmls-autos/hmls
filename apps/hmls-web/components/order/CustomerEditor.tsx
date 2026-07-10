import type { ContactMethod } from "@hmls/shared/api/contracts/orders";
import { CONTACT_METHODS } from "@hmls/shared/api/contracts/orders";
import { Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OrderContactPatch } from "@/hooks/useOrderMutations";

type ContactSnapshot = {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  contactPreferred: ContactMethod | null;
};

export function CustomerEditor({
  order,
  onSave,
  onCancel,
  saving,
}: {
  order: ContactSnapshot;
  onSave: (data: OrderContactPatch) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(order.contactName ?? "");
  const [email, setEmail] = useState(order.contactEmail ?? "");
  const [phone, setPhone] = useState(order.contactPhone ?? "");
  const [address, setAddress] = useState(order.contactAddress ?? "");
  const [preferred, setPreferred] = useState<ContactMethod | null>(
    order.contactPreferred,
  );

  return (
    <div className="border border-border rounded-lg p-4 bg-muted space-y-3">
      <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">
        Edit Contact (this order only)
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-xs h-8"
        />
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="text-xs h-8"
        />
        <Input
          type="tel"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="text-xs h-8"
        />
      </div>
      <Textarea
        placeholder="Address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        rows={2}
        className="text-xs min-h-0 resize-y"
      />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Prefers</span>
        {CONTACT_METHODS.map((method) => (
          <Button
            key={method}
            type="button"
            variant={preferred === method ? "secondary" : "ghost"}
            size="xs"
            className="capitalize"
            aria-pressed={preferred === method}
            onClick={() => setPreferred(preferred === method ? null : method)}
          >
            {method}
          </Button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() =>
            onSave({
              contact_name: name,
              contact_email: email,
              contact_phone: phone,
              contact_address: address,
              contact_preferred: preferred,
            })
          }
          disabled={saving}
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
