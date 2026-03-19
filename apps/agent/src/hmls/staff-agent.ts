import { hasToolCall, type ModelMessage, stepCountIs, streamText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getLogger } from "@logtape/logtape";
import { STAFF_SYSTEM_PROMPT } from "./staff-system-prompt.ts";
import { schedulingTools } from "./tools/scheduling.ts";
import { orderOpsTools } from "./tools/order-ops.ts";
import { adminOrderTools } from "./tools/admin-order-tools.ts";
import { convertTools, type LegacyTool } from "../common/convert-tools.ts";
import { askUserQuestionTools } from "../common/tools/ask-user-question.ts";
import { laborLookupTools } from "../common/tools/labor-lookup.ts";
import { partsLookupTools } from "../common/tools/parts-lookup.ts";
import { estimateTools } from "../common/tools/estimate.ts";
import type { AgentConfig } from "./agent.ts";

const logger = getLogger(["hmls", "agent", "staff"]);

const DEFAULT_MODEL = "gemini-3-flash";

export interface RunStaffAgentOptions {
  messages: ModelMessage[];
  config: AgentConfig;
}

export function runStaffAgent(options: RunStaffAgentOptions) {
  const { messages, config } = options;
  const modelId = config.agentModel || DEFAULT_MODEL;

  const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });

  const allTools: LegacyTool[] = [
    ...askUserQuestionTools,
    ...estimateTools,
    ...schedulingTools,
    ...laborLookupTools,
    ...partsLookupTools,
    ...orderOpsTools,
    ...adminOrderTools,
  ];

  const tools = convertTools(allTools);
  const toolCount = Object.keys(tools).length;
  logger.info("Initializing staff agent", { model: modelId, toolCount });

  return streamText({
    model: google(modelId),
    system: STAFF_SYSTEM_PROMPT,
    messages,
    tools,
    stopWhen: [stepCountIs(25), hasToolCall("ask_user_question")],
    onStepFinish: (step) => {
      const toolCalls = step.toolCalls ?? [];
      if (toolCalls.length > 0) {
        logger.debug("Step tool calls", {
          toolNames: toolCalls.map((t) => t.toolName),
        });
      }
      if (step.finishReason && step.finishReason !== "tool-calls") {
        logger.info("Staff agent step finished", {
          finishReason: step.finishReason,
          inputTokens: step.usage?.inputTokens,
          outputTokens: step.usage?.outputTokens,
        });
      }
    },
  });
}
