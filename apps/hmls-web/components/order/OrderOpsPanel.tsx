"use client";

import type { Order } from "@hmls/shared/db/types";
import {
  leadAction,
  type OrderInvoker,
  visibleOpsActions,
} from "@/lib/order-actions";
import { ActionButton } from "./ActionButton";
import { DialogHost } from "./DialogHost";

type Props = {
  order: Order;
  invoker: OrderInvoker;
  revalidate(): void;
  suggestedDurationMinutes: number;
};

// Schedule / mechanic edits have a contextual home in the Appointment section
// (ScheduleSection), shown whenever schedule is editable. Keep this row to
// lifecycle transitions only so the two don't render the same
// "Reschedule" / "Reassign" buttons side by side.

/** Inline lifecycle-action row for the order title bar — quiet actions first,
 *  the lead action last (rightmost). Also mounts DialogHost, so any surface
 *  that calls `invoker.openDialog` (e.g. ScheduleSection) relies on this
 *  rendering whenever the order is non-terminal. */
export function OrderOpsPanel({
  order,
  invoker,
  revalidate,
  suggestedDurationMinutes,
}: Props) {
  const visible = visibleOpsActions(order);
  // Nothing to show on terminal statuses with no actions.
  if (visible.length === 0) return null;

  const primary = leadAction(order);
  const rest = visible.filter((a) => a !== primary);

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {rest.map((a) => (
        <ActionButton
          key={a.id}
          action={a}
          order={order}
          onClick={invoker.invoke}
          disabled={invoker.transitioning}
        />
      ))}
      {primary && (
        <ActionButton
          action={primary}
          order={order}
          onClick={invoker.invoke}
          disabled={invoker.transitioning}
          prominent
        />
      )}
      <DialogHost
        order={order}
        invoker={invoker}
        revalidate={revalidate}
        suggestedDurationMinutes={suggestedDurationMinutes}
      />
    </div>
  );
}
