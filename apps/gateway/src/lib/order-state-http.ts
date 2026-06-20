// Bridge between the order-state harness's Result type and Hono responses.
// Keeps HTTP-specific error mapping out of the harness core.

import type { Context } from "hono";
import type { OrderStateError, OrderStateResult } from "@hmls/agent/order-state";

/** Map a harness error to an HTTP response shape. */
export function orderStateErrorResponse(
  err: OrderStateError,
): { status: 400 | 403 | 404 | 409; body: { error: { code: string; message: string } } } {
  switch (err.code) {
    case "not_found":
      return {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: `Order #${err.orderId} not found` } },
      };
    case "forbidden":
      return {
        status: 403,
        body: { error: { code: "FORBIDDEN", message: err.reason } },
      };
    case "conflict":
      return {
        status: 409,
        body: { error: { code: "CONFLICT", message: err.message } },
      };
    case "invalid_transition":
      return {
        status: 400,
        body: {
          error: {
            code: "BAD_REQUEST",
            message: `Cannot transition from '${err.from}' to '${err.to}'`,
          },
        },
      };
    case "terminal_state":
      return {
        status: 400,
        body: {
          error: {
            code: "BAD_REQUEST",
            message: `Order is in terminal '${err.status}' state`,
          },
        },
      };
    case "not_editable":
      return {
        status: 400,
        body: {
          error: {
            code: "BAD_REQUEST",
            message: `Order in '${err.status}' status cannot be edited`,
          },
        },
      };
    case "invalid_input":
      return {
        status: 400,
        body: { error: { code: "BAD_REQUEST", message: err.message } },
      };
  }
}

/** Send a harness Result as a Hono JSON response. On success returns the
 *  row; on error maps the OrderStateError to the right status code. */
// deno-lint-ignore no-explicit-any
export function sendOrderStateResult<T>(c: Context<any, any, any>, result: OrderStateResult<T>) {
  if (result.ok) return c.json(result.value);
  const { status, body } = orderStateErrorResponse(result.error);
  return c.json(body, status);
}
