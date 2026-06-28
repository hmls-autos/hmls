import { z } from "zod";
import { toolResult } from "@hmls/shared/tool-result";

export const collectContactTool = {
  name: "collect_contact",
  description:
    "Show the customer a short form to collect their contact phone, the service address we " +
    "should come to, and any access notes (gate code, parking, unit #). Call this ONCE when you " +
    "need the customer's contact + location for a mobile service — do NOT also ask for these in " +
    "plain text. The customer fills the form and their answer comes back as the next message. " +
    "Pass `note` for a one-line context (e.g. the service being booked).",
  schema: z.object({
    note: z
      .string()
      .optional()
      .describe("Optional one-line context shown on the form, e.g. 'for the oil change'"),
  }),
  // deno-lint-ignore require-await
  execute: async (_params: { note?: string }, _ctx: unknown) => {
    // The result is a no-op ack — the frontend intercepts this tool call's input
    // and renders the contact form. The filled-in values arrive as the next
    // user message, same pattern as ask_user_question.
    return toolResult({
      status: "form_presented",
      message: "Waiting for customer to submit contact + address.",
    });
  },
};

export const collectContactTools = [collectContactTool];
