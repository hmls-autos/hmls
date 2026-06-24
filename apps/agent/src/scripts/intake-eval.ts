// apps/agent/src/scripts/intake-eval.ts
//
// Intake-behavior eval for the HMLS customer agent. Runs runHmlsAgent on a
// scripted single turn and checks: (1) repair symptom → diagnose_symptom is
// called BEFORE create_order; (2) the assistant TEXT never leaks internalScope
// jargon (candidate-system / root-cause terms); (3) maintenance → diagnose_symptom
// is NOT called. Real model + OLP DB.
//
// Model switch: set AGENT_MODEL to A/B Gemini models (e.g. gemini-3.1-flash-lite
// vs gemini-3-flash-preview) without code changes — it threads into config.agentModel.
// (Off-family providers (DeepSeek/GLM/Qwen) would need a provider swap in agent.ts,
// not just this env var — that's a separate change.)
//
// Run: infisical run --env=dev -- deno run -A apps/agent/src/scripts/intake-eval.ts
//      AGENT_MODEL=gemini-3.1-flash-lite infisical run --env=dev -- deno run -A apps/agent/src/scripts/intake-eval.ts
import { runHmlsAgent } from "../hmls/agent.ts";

const apiKey = Deno.env.get("GOOGLE_API_KEY");
if (!apiKey) {
  console.error("GOOGLE_API_KEY required (run via infisical).");
  Deno.exit(2);
}
const agentModel = Deno.env.get("AGENT_MODEL") || undefined;
console.log(`model: ${agentModel ?? "(default) gemini-3-flash-preview"}\n`);

interface Trace {
  toolOrder: string[];
  text: string;
}

async function runTurn(prompt: string): Promise<Trace> {
  const result = await runHmlsAgent({
    messages: [{ role: "user", content: prompt }],
    config: { googleApiKey: apiKey!, agentModel },
  });
  const toolOrder: string[] = [];
  let text = "";
  for await (const part of result.fullStream) {
    // deno-lint-ignore no-explicit-any
    const p = part as any;
    if (p.type === "tool-call" && p.toolName) toolOrder.push(p.toolName as string);
    if (p.type === "text-delta") text += p.text ?? p.textDelta ?? p.delta ?? "";
  }
  await result.text;
  return { toolOrder, text };
}

// Leak terms: candidate-system / root-cause vocabulary that must never reach the customer.
const LEAK_TERMS = ["candidate system", "root cause", "ignition system", "fuel system"];

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  — " + detail}`);
  if (!ok) failures++;
}

// Scenario A — repair symptom (no address → create_order writes nothing).
{
  const t = await runTurn(
    "My 2015 Honda Civic, 90k miles, has a grinding/squealing noise from the front when I brake " +
      "at low speed, getting louder this week. No warning lights.",
  );
  const di = t.toolOrder.indexOf("diagnose_symptom");
  const co = t.toolOrder.indexOf("create_order");
  check("repair: diagnose_symptom is called", di >= 0, `tools=${t.toolOrder.join(",")}`);
  check(
    "repair: diagnose_symptom precedes create_order (if both ran)",
    di >= 0 && (co < 0 || di < co),
    `tools=${t.toolOrder.join(",")}`,
  );
  const leaked = LEAK_TERMS.filter((term) => t.text.toLowerCase().includes(term));
  check(
    "repair: no internalScope leak in assistant text",
    leaked.length === 0,
    `leaked=${leaked.join(",")}`,
  );
}

// Scenario B — routine maintenance (must NOT diagnose).
{
  const t = await runTurn("I just need an oil change for my 2020 Toyota Camry.");
  check(
    "maintenance: diagnose_symptom is NOT called",
    !t.toolOrder.includes("diagnose_symptom"),
    `tools=${t.toolOrder.join(",")}`,
  );
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
Deno.exit(failures === 0 ? 0 : 1);
