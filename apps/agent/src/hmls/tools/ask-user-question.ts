import { z } from "zod";
import { toolResult } from "@hmls/shared/tool-result";

export const askUserQuestionTool = {
  name: "ask_user_question",
  description:
    "Present the customer with a structured question card with clickable options. Use this instead of asking open-ended questions when the answer is one of a known set of choices. Examples: selecting a service, confirming an action (yes/no), choosing between options. The customer will see buttons they can tap. Only ask ONE question at a time.",
  schema: z.object({
    question: z.string().describe("The question to ask the customer"),
    header: z.string().describe("Short label displayed above the question (2-4 words)"),
    options: z
      .array(
        z.object({
          label: z.string().describe("Button text for this option (1-5 words)"),
          description: z
            .string()
            .optional()
            .describe("Optional extra context shown below the label"),
        }),
      )
      .min(2)
      .max(6)
      .describe("The choices the customer can pick from"),
  }),
  // deno-lint-ignore require-await
  execute: async (
    _params: {
      question: string;
      header: string;
      options: { label: string; description?: string }[];
    },
    _ctx: unknown,
  ) => {
    // The tool result doesn't matter much — the frontend intercepts the tool call args
    // and renders the question card. The user's answer comes as the next message.
    return toolResult({
      status: "question_presented",
      message: "Waiting for customer response.",
    });
  },
};

export const askUserQuestionTools = [askUserQuestionTool];
