// Bridge between order-state harness results and the `toolResult` shape
// that agent tools return to the LLM. Mirrors lib/order-state-http.ts for
// HTTP routes — same error mapping, different envelope.

import { toolResult } from "@hmls/shared/tool-result";
import type { Actor } from "@hmls/shared/order/status";
import type { OrderStateError, OrderStateResult } from "./order-state.ts";
import type { ToolContext } from "../common/convert-tools.ts";

/** Build a customer-chat agent Actor. Requires authenticated customer in ctx. */
export function customerAgentActor(ctx: ToolContext | undefined): Actor | null {
  if (!ctx?.customerId) return null;
  return {
    kind: "agent",
    surface: "customer_chat",
    actingAs: { kind: "customer", customerId: ctx.customerId },
  };
}

/** Build a staff-chat agent Actor. Admin email falls back to "staff_agent"
 *  when the gateway did not thread it through — the audit trail is still
 *  identifiable, just less specific. */
export function staffAgentActor(ctx: ToolContext | undefined): Actor {
  return {
    kind: "agent",
    surface: "staff_chat",
    actingAs: { kind: "admin", email: ctx?.adminEmail ?? "staff_agent" },
  };
}

/** Map an OrderStateError to a tool-visible error message. Tools return
 *  human-readable strings since the LLM consumes these directly. */
export function orderStateErrorMessage(err: OrderStateError): string {
  switch (err.code) {
    case "not_found":
      return `Order #${err.orderId} not found`;
    case "invalid_transition":
      return `Cannot transition from '${err.from}' to '${err.to}'`;
    case "forbidden":
      return err.reason;
    case "conflict":
      return err.message;
    case "terminal_state":
      return `Order is in terminal '${err.status}' state`;
    case "not_editable":
      return `Order in '${err.status}' status cannot be edited`;
    case "invalid_input":
      return err.message;
    default: {
      const _exhaustive: never = err;
      throw new Error(`Unhandled OrderStateError: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Convert an OrderStateResult into the standard `toolResult` envelope.
 *  `onSuccess` lets the caller shape the success payload (e.g. include a
 *  custom `message` for the LLM). */
export function toolResultFromOrderState<T>(
  result: OrderStateResult<T>,
  onSuccess: (value: T) => Record<string, unknown>,
): ReturnType<typeof toolResult> {
  if (!result.ok) {
    return toolResult({ success: false, error: orderStateErrorMessage(result.error) });
  }
  return toolResult({ success: true, ...onSuccess(result.value) });
}
