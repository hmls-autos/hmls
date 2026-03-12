import { createDiagnosticAgent } from "../agent.ts";

// Agent singleton
let agent: Awaited<ReturnType<typeof createDiagnosticAgent>> | null = null;

export async function getAgent() {
  if (!agent) {
    agent = await createDiagnosticAgent();
  }
  return agent;
}
