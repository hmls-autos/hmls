import { hasToolCall, type ModelMessage, stepCountIs, streamText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getLogger } from "@logtape/logtape";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { analyzeAudioNoiseTool } from "./tools/analyzeAudioNoise.ts";
import { extractVideoFramesTool } from "./tools/extractVideoFrames.ts";
import { lookupObdCodeTool } from "./tools/lookupObdCode.ts";
import { convertTools, type LegacyTool } from "../common/convert-tools.ts";
import { askUserQuestionTools } from "../common/tools/ask-user-question.ts";
import { laborLookupTools } from "../common/tools/labor-lookup.ts";
import { partsLookupTools } from "../common/tools/parts-lookup.ts";
import { createFixoEstimateTool } from "./tools/fixo-estimate.ts";

const DEFAULT_MODEL = "gemini-3-flash-preview";

const logger = getLogger(["hmls", "agent", "fixo"]);

export interface RunFixoAgentOptions {
  messages: ModelMessage[];
  userId?: string;
}

export function runFixoAgent(options: RunFixoAgentOptions) {
  const apiKey = Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required");
  }

  const modelId = Deno.env.get("AGENT_MODEL") || DEFAULT_MODEL;
  const google = createGoogleGenerativeAI({ apiKey });

  const allTools: LegacyTool[] = [
    // Photos and audio spectrograms reach the model as FileUIParts hydrated
    // by the gateway in /task. analyzeImage / saveMedia / getMedia tools are
    // gone — the model sees images directly. analyzeAudioNoise stays as a
    // belt-and-suspenders option for the spectrogram path until D12's
    // experiment retires it.
    analyzeAudioNoiseTool,
    extractVideoFramesTool,
    lookupObdCodeTool,
    ...askUserQuestionTools,
    ...laborLookupTools,
    ...partsLookupTools,
    createFixoEstimateTool,
  ];

  const tools = convertTools(allTools, { userId: options.userId });
  const toolCount = Object.keys(tools).length;
  logger.info("Initializing Fixo agent", { model: modelId, toolCount });

  return streamText({
    model: google(modelId),
    system: SYSTEM_PROMPT,
    messages: options.messages,
    tools,
    stopWhen: [stepCountIs(10), hasToolCall("ask_user_question")],
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
