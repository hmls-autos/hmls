"use client";

import { useState } from "react";

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
    const parts = [
      `Contact phone: ${phone.trim()}.`,
      `Service address: ${address.trim()}.`,
    ];
    if (access.trim()) parts.push(`Access notes: ${access.trim()}.`);
    onSubmit(parts.join(" "));
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
