import { hasToolCall, type ModelMessage, stepCountIs, streamText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { schedulingTools } from "./tools/scheduling.ts";
import { createStripeTools } from "./tools/stripe.ts";
import { estimateTools } from "./skills/estimate/tools.ts";
import { askUserQuestionTools } from "./tools/ask-user-question.ts";
import { laborLookupTools } from "./tools/labor-lookup.ts";
import { partsLookupTools } from "./tools/parts-lookup.ts";
import { formatUserContext, type UserContext } from "../types/user-context.ts";

const DEFAULT_MODEL = "gemini-2.5-flash";

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

// deno-lint-ignore no-explicit-any
interface LegacyTool<P = any> {
  name: string;
  description: string;
  // deno-lint-ignore no-explicit-any
  schema: any;
  execute: (params: P, ctx: unknown) => Promise<unknown>;
}

/** Convert existing tool arrays (name/schema/execute) to AI SDK tool records. */
// deno-lint-ignore no-explicit-any
function convertTools(existingTools: LegacyTool[]): Record<string, any> {
  // deno-lint-ignore no-explicit-any
  const result: Record<string, any> = {};
  for (const t of existingTools) {
    result[t.name] = {
      description: t.description,
      inputSchema: t.schema,
      execute: (input: unknown) => t.execute(input, undefined),
    };
  }
  return result;
}

export function runHmlsAgent(options: RunAgentOptions) {
  const { messages, config, userContext } = options;
  const modelId = config.agentModel || DEFAULT_MODEL;
  console.log(`[agent] Running HMLS agent with model: ${modelId}`);

  const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });

  const systemPrompt = userContext
    ? `${SYSTEM_PROMPT}\n\n${formatUserContext(userContext)}`
    : SYSTEM_PROMPT;

  const allTools: LegacyTool[] = [
    ...askUserQuestionTools,
    ...estimateTools,
    ...(config.stripeSecretKey ? createStripeTools(config.stripeSecretKey) : []),
    ...schedulingTools,
    ...laborLookupTools,
    ...partsLookupTools,
  ];

  const tools = convertTools(allTools);

  return streamText({
    model: google(modelId),
    system: systemPrompt,
    messages,
    tools,
    stopWhen: [stepCountIs(10), hasToolCall("ask_user_question")],
  });
}
