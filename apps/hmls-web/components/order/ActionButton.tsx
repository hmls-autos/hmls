"use client";

import type { Order } from "@hmls/shared/db/types";
import { Button } from "@/components/ui/button";
import type { ActionDescriptor } from "@/lib/order-actions";
import { cn } from "@/lib/utils";

type Props = {
  action: ActionDescriptor;
  order: Order;
  onClick(action: ActionDescriptor): void;
  /** Render featured (the lead-action slot). */
  prominent?: boolean;
  disabled?: boolean;
};

export function ActionButton({
  action,
  order,
  onClick,
  prominent,
  disabled,
}: Props) {
  const variant = action.variant(order);
  const label = action.label(order);
  const actionEnabled = action.enabled(order);
  const isEnabled = actionEnabled && !disabled;
  // Disabled buttons swallow pointer events, so the hint rides on a wrapper.
  const hint = !actionEnabled ? action.disabledHint?.(order) : undefined;

  return (
    <span title={hint}>
      <Button
        variant={
          variant === "danger" ? "outline" : prominent ? "default" : "ghost"
        }
        size={prominent ? "sm" : "xs"}
        disabled={!isEnabled}
        onClick={() => onClick(action)}
        className={cn(
          variant === "danger" &&
            "text-destructive border-destructive/30 hover:bg-destructive/10",
        )}
      >
        {label}
      </Button>
    </span>
  );
}
