import { generateObject, type ModelMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { getLogger } from "@logtape/logtape";

const DEFAULT_MODEL = "gemini-3-flash-preview";

const logger = getLogger(["hmls", "agent", "fixo", "summarize"]);

const severityEnum = z.enum(["critical", "high", "medium", "low"]);

const issueSchema = z.object({
  title: z.string().describe("Short label for the issue, e.g. 'Worn brake pads'."),
  severity: severityEnum.describe(
    "How urgent the issue is. critical = unsafe to drive, high = fix soon, medium = monitor, low = informational.",
  ),
  description: z.string().describe(
    "1-2 sentence plain-English description of the issue and what evidence supports it.",
  ),
  recommendedAction: z.string().describe(
    "What the customer should do next, e.g. 'Replace front brake pads at next service.'",
  ),
  estimatedCost: z.string().optional().describe(
    "Optional rough cost range as a string, e.g. '$200-$400'. Omit if unknown.",
  ),
});

const obdCodeSchema = z.object({
  code: z.string().describe("OBD-II code like 'P0301'."),
  meaning: z.string().describe("Plain-English meaning of the code."),
  severity: z.string().describe("Severity label, ideally critical/high/medium/low."),
});

export const fixoResultSchema = z.object({
  summary: z.string().describe(
    "2-4 sentence plain-English summary of the diagnostic conversation and the overall vehicle condition.",
  ),
  overallSeverity: severityEnum.describe(
    "Worst severity across all issues found.",
  ),
  issues: z.array(issueSchema).describe(
    "Distinct issues identified in this session. Use [] when nothing concrete was found.",
  ),
  obdCodes: z.array(obdCodeSchema).optional().describe(
    "OBD-II codes referenced in the conversation, with meaning and severity.",
  ),
});

export type FixoSessionResult = z.infer<typeof fixoResultSchema>;

const SUMMARIZE_SYSTEM_PROMPT =
  `You are an automotive diagnostic assistant generating the FINAL structured report for a Fixo session.

You are given the full chat history between a customer and the diagnostic agent (text, photos, OBD codes, audio analysis). Distill it into a structured report.

Rules:
- Only report issues actually surfaced or strongly implied in the conversation. Do not invent symptoms.
- "issues" must be empty if the conversation never reached a diagnosis (e.g., user only said "hi"). The report is still valid.
- "overallSeverity" must equal the highest severity across "issues". If issues is empty, use "low".
- Be concrete. Reference specific symptoms, codes, or photos from the conversation in the description.
- Do not include marketing language, disclaimers, or apologies.`;

export interface SummarizeFixoSessionOptions {
  messages: ModelMessage[];
  modelId?: string;
}

export async function summarizeFixoSession(
  options: SummarizeFixoSessionOptions,
): Promise<FixoSessionResult> {
  const apiKey = Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required");
  }

  if (!options.messages || options.messages.length === 0) {
    throw new Error("Cannot summarize a session with no messages");
  }

  const modelId = options.modelId ?? Deno.env.get("AGENT_MODEL") ?? DEFAULT_MODEL;
  const google = createGoogleGenerativeAI({ apiKey });

  logger.info("Summarizing fixo session", {
    model: modelId,
    messageCount: options.messages.length,
  });

  const { object } = await generateObject({
    model: google(modelId),
    schema: fixoResultSchema,
    system: SUMMARIZE_SYSTEM_PROMPT,
    messages: options.messages,
  });

  return object;
}
