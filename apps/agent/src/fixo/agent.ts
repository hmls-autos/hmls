import { type Message as ZypherMessage, ZypherAgent, type ZypherContext } from "@corespeed/zypher";
import { GeminiOpenAIProvider } from "../llm/gemini-openai-provider.ts";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { analyzeImageTool } from "./tools/analyzeImage.ts";
import { analyzeAudioNoiseTool } from "./tools/analyzeAudioNoise.ts";
import { extractVideoFramesTool } from "./tools/extractVideoFrames.ts";
import { lookupObdCodeTool } from "./tools/lookupObdCode.ts";
import { getMediaTool, saveMediaTool } from "./tools/storage.ts";

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

const allTools = [
  analyzeImageTool,
  analyzeAudioNoiseTool,
  extractVideoFramesTool,
  lookupObdCodeTool,
  saveMediaTool,
  getMediaTool,
];

export interface CreateDiagnosticAgentOptions {
  /** Previous conversation messages to restore context */
  initialMessages?: ZypherMessage[];
}

export async function createDiagnosticAgent(options?: CreateDiagnosticAgentOptions) {
  const apiKey = Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required");
  }

  const modelId = Deno.env.get("AGENT_MODEL") || DEFAULT_MODEL;
  console.log(`[diagnostic-agent] Creating agent with model: ${modelId}`);

  const isDenoDeploy = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

  const modelProvider = new GeminiOpenAIProvider({
    model: modelId,
    apiKey,
    baseUrl: GEMINI_BASE_URL,
  });

  const context: ZypherContext = isDenoDeploy
    ? {
      workingDirectory: "/src",
      zypherDir: "/tmp/.zypher-diag",
      workspaceDataDir: "/tmp/.zypher-diag/data",
      fileAttachmentCacheDir: "/tmp/.zypher-diag/cache",
      skillsDir: "/tmp/.zypher-diag/skills",
    }
    : {
      workingDirectory: Deno.cwd(),
      zypherDir: `${Deno.cwd()}/.zypher`,
      workspaceDataDir: `${Deno.cwd()}/.zypher/data`,
      fileAttachmentCacheDir: `${Deno.cwd()}/.zypher/cache`,
      skillsDir: `${Deno.cwd()}/.zypher/skills`,
    };

  const agent = new ZypherAgent(
    context,
    modelProvider,
    {
      tools: allTools,
      initialMessages: options?.initialMessages,
      overrides: {
        // deno-lint-ignore require-await
        systemPromptLoader: async () => SYSTEM_PROMPT,
      },
    },
  );

  // Discover and log skills
  if (!isDenoDeploy) {
    await agent.skills.discover();
    const skillNames = Array.from(agent.skills.skills.values()).map(
      (s) => s.metadata.name,
    );
    if (skillNames.length > 0) {
      console.log(`[diagnostic-agent] Skills loaded: ${skillNames.join(", ")}`);
    }
  }

  return agent;
}
