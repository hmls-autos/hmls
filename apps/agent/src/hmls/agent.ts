import { hasToolCall, type ModelMessage, stepCountIs, streamText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getLogger } from "@logtape/logtape";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { schedulingTools } from "./tools/scheduling.ts";
import { createStripeTools } from "./tools/stripe.ts";
import { orderOpsTools } from "./tools/order-ops.ts";
import { customerOrderActionTools } from "./tools/customer-order-actions.ts";
import { customerBookingActionTools } from "./tools/customer-booking-actions.ts";
import { formatUserContext, type UserContext } from "../types/user-context.ts";
import { convertTools, type LegacyTool } from "../common/convert-tools.ts";
import { askUserQuestionTools } from "../common/tools/ask-user-question.ts";
import { laborLookupTools } from "../common/tools/labor-lookup.ts";
import { partsLookupTools } from "../common/tools/parts-lookup.ts";
import { estimateTools } from "../common/tools/estimate.ts";

const logger = getLogger(["hmls", "agent", "hmls"]);

const DEFAULT_MODEL = "gemini-3-flash-preview";

export interface AgentConfig {
  googleApiKey: string;
  stripeSecretKey: string;
  agentModel?: string;
}

export interface RunAgentOptions {
  messages: ModelMessage[];
  config: AgentConfig;
  userContext?: UserContext;
}

export function runHmlsAgent(options: RunAgentOptions) {
  const { messages, config, userContext } = options;
  const modelId = config.agentModel || DEFAULT_MODEL;

  const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });

  const systemPrompt = userContext
    ? `${SYSTEM_PROMPT}\n\n${formatUserContext(userContext)}`
    : SYSTEM_PROMPT;

  // Customer agent uses restricted order tools — no direct status transitions,
  // only approve/decline/cancel/request_reschedule + read-only get_order_status
  const customerOrderTools = [
    orderOpsTools.find((t) => t.name === "get_order_status")!,
    orderOpsTools.find((t) => t.name === "add_order_note")!,
    ...customerOrderActionTools,
    ...customerBookingActionTools,
  ];

  const allTools: LegacyTool[] = [
    ...askUserQuestionTools,
    ...estimateTools,
    ...(config.stripeSecretKey ? createStripeTools(config.stripeSecretKey) : []),
    ...schedulingTools,
    ...laborLookupTools,
    ...partsLookupTools,
    ...customerOrderTools,
  ];

  const toolCtx = userContext ? { customerId: userContext.id } : undefined;
  const tools = convertTools(allTools, toolCtx);
  const toolCount = Object.keys(tools).length;
  logger.info("Initializing HMLS agent", { model: modelId, toolCount });

  return streamText({
    model: google(modelId),
    system: systemPrompt,
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
        logger.info("Agent step finished", {
          finishReason: step.finishReason,
          inputTokens: step.usage?.inputTokens,
          outputTokens: step.usage?.outputTokens,
        });
      }
    },
  });
}
