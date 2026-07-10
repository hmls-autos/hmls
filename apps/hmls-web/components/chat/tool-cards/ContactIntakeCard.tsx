"use client";

import type { ContactMethod } from "@hmls/shared/api/contracts/orders";
import { useState } from "react";

/** Formats the card's fields into the next user message. The agent re-extracts
 * these values, so the format is a contract: `Preferred contact:` must carry
 * the exact lowercase token — create_order validates z.enum(["text","call","email"]). */
export function buildContactMessage({
  phone,
  address,
  access,
  preferred,
}: {
  phone: string;
  address: string;
  access: string;
  preferred: ContactMethod | null;
}): string {
  const parts = [
    `Contact phone: ${phone.trim()}.`,
    `Service address: ${address.trim()}.`,
  ];
  if (access.trim()) parts.push(`Access notes: ${access.trim()}.`);
  if (preferred) parts.push(`Preferred contact: ${preferred}.`);
  return parts.join(" ");
}

/** Interactive form that mirrors the `collect_contact` tool. The agent calls
 * the tool when it needs the customer's phone + service address + access notes;
 * this card renders discrete fields instead of a plain-text question, so the
 * data comes back clean (the address especially — it drives shop routing).
 * Submitting formats the fields into the next user message, same pattern as
 * AskUserQuestionCard / SlotPickerCard.
 *
 * Two states:
 *  - active — most recent collect_contact with no follow-up message; editable.
 *  - answered — a previous turn the user already submitted; read-only summary. */
export function ContactIntakeCard({
  note,
  isAnswered,
  answer,
  onSubmit,
}: {
  note?: string;
  isAnswered: boolean;
  answer?: string;
  onSubmit: (message: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [access, setAccess] = useState("");
  // Exact lowercase tokens — create_order validates z.enum(["text","call","email"])
  const [preferred, setPreferred] = useState<ContactMethod | null>(null);

  if (isAnswered) {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contact & location
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {answer ?? "Submitted."}
        </p>
      </div>
    );
  }

  const canSubmit = phone.trim().length > 0 && address.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(buildContactMessage({ phone, address, access, preferred }));
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-primary/80">
        Contact & location
      </div>
      <p className="mt-1 text-sm font-medium text-foreground">
        Where should we come, and how do we reach you{note ? ` ${note}` : ""}?
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number"
          autoComplete="tel"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        />
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Service address (street, city, ZIP)"
          autoComplete="street-address"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        />
        <textarea
          value={access}
          onChange={(e) => setAccess(e.target.value)}
          placeholder="Gate code, parking, unit # (optional)"
          rows={2}
          className="resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        />
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            How should we reach you? (optional)
          </div>
          <div className="flex gap-1.5">
            {(["text", "call", "email"] as const).map((method) => (
              <button
                key={method}
                type="button"
                aria-pressed={preferred === method}
                onClick={() =>
                  setPreferred(preferred === method ? null : method)
                }
                className={`flex-1 rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
                  preferred === method
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-primary/10"
                }`}
              >
                {method}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
