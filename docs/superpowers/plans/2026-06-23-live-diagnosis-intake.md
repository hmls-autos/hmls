# Live Diagnosis in Intake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the HMLS customer chat agent a `diagnose_symptom` tool that runs the Fixo brain DURING intake, so it asks the right follow-up questions and surfaces safety warnings before drafting the order.

**Architecture:** A contract-decoupled `diagnose()` client wraps the non-persisting in-process `diagnoseStructured()`. A new `diagnose_symptom` agent tool calls it and returns a curated, shop-only-marked result. The system prompt makes the agent call it first on repair/diagnostic symptoms. `create_order` and the outcome loop are UNCHANGED — the brain still runs fire-and-forget at create time as the persisted prediction-of-record.

**Tech Stack:** Deno + TypeScript, AI SDK v6 (`streamText`), Zod, `@std/assert` (Deno.test). Spec: `docs/superpowers/specs/2026-06-23-live-diagnosis-intake-design.md` (`682df7c`).

## Global Constraints

- Deno apps: `deno fmt` (double quotes, 2-space indent, 100-col), `deno lint`, strict TS.
- Tools follow the `LegacyTool` shape `{ name, description, schema (zod), execute(params, ctx?) }` and return via `toolResult` from `@hmls/shared/tool-result`.
- `diagnose()` is best-effort: returns `null` on any thrown failure, never throws. A degraded empty-candidate diagnosis is a NON-null success.
- Internal diagnosis fields (`candidate_systems` / `likely_root_cause`) are SHOP-ONLY — never recited to the customer. `safety_flags` MAY reach the customer as caution.
- No change to `create_order` (`apps/agent/src/common/tools/order.ts`) or the outcome loop (`apps/gateway/src/routes/orders.ts:361-370`). Do NOT add a `recordOutcome` call at the `completed` transition (double-fire).
- Run checks via Infisical (injects `GOOGLE_API_KEY` + `DATABASE_URL`). Pure unit tests need neither.

---

## File Structure

- Create: `apps/agent/src/common/fixo-diagnose.ts` — the `diagnose()` client (transport seam).
- Create: `apps/agent/src/common/fixo-diagnose_test.ts` — unit tests for the client.
- Create: `apps/agent/src/hmls/tools/diagnose-symptom.ts` — the `diagnose_symptom` tool + pure `shapeDiagnosis`.
- Create: `apps/agent/src/hmls/tools/diagnose-symptom_test.ts` — unit tests for `shapeDiagnosis`.
- Modify: `apps/agent/src/hmls/agent.ts:11-15,62-70` — import + register the tool.
- Modify: `apps/agent/src/hmls/system-prompt.ts:39-42,66-69` — repair-branch precondition + tool-call discipline rule.
- Create: `apps/agent/src/scripts/intake-eval.ts` — real-model eval (tool-order + leak gate).

---

### Task 1: `diagnose()` client

**Files:**
- Create: `apps/agent/src/common/fixo-diagnose.ts`
- Test: `apps/agent/src/common/fixo-diagnose_test.ts`

**Interfaces:**
- Consumes: `diagnoseStructured(input: DiagnoseOnceInput): Promise<StructuredDiagnosis>` and `type StructuredDiagnosis` from `../fixo/diagnose-structured.ts`; `type DiagnoseOnceInput` (`{ vehicle: { year: number|string; make: string; model: string }; symptom: string; dtcs?: string[] }`) from `../fixo/run-once-prompt.ts`.
- Produces: `diagnose(input: DiagnoseInput, run?): Promise<StructuredDiagnosis | null>` and `interface DiagnoseInput { vehicle: { year?: number|string; make?: string; model?: string }; symptom: string; dtcs?: string[]; imageRefs?: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/agent/src/common/fixo-diagnose_test.ts
import { assert, assertEquals } from "@std/assert";
import { diagnose } from "./fixo-diagnose.ts";
import type { StructuredDiagnosis } from "../fixo/diagnose-structured.ts";
import type { DiagnoseOnceInput } from "../fixo/run-once-prompt.ts";

const SAMPLE: StructuredDiagnosis = {
  candidate_systems: [{ system: "ignition", confidence: 3, reasons: ["P0300"] }],
  likely_root_cause: "worn spark plugs",
  recommended_tests: ["inspect plugs"],
  safety_flags: [],
  to_confirm: ["miles since last plug change?"],
  narrative: "misfire",
};

Deno.test("diagnose — maps input onto DiagnoseOnceInput, drops imageRefs", async () => {
  let seen: DiagnoseOnceInput | null = null;
  const out = await diagnose(
    { vehicle: { year: 2019, make: "Honda", model: "Accord" }, symptom: "shakes", dtcs: ["P0300"], imageRefs: ["x"] },
    (i) => { seen = i; return Promise.resolve(SAMPLE); },
  );
  assertEquals(out, SAMPLE);
  assertEquals(seen!.symptom, "shakes");
  assertEquals(seen!.dtcs, ["P0300"]);
  assertEquals(seen!.vehicle.make, "Honda");
  assert(!("imageRefs" in (seen as object)));
});

Deno.test("diagnose — missing vehicle fields default to empty strings", async () => {
  let seen: DiagnoseOnceInput | null = null;
  await diagnose({ vehicle: {}, symptom: "x" }, (i) => { seen = i; return Promise.resolve(SAMPLE); });
  assertEquals(seen!.vehicle.make, "");
  assertEquals(seen!.vehicle.model, "");
  assertEquals(seen!.vehicle.year, "");
});

Deno.test("diagnose — returns null on a thrown error", async () => {
  const out = await diagnose({ vehicle: {}, symptom: "x" }, () => { throw new Error("boom"); });
  assertEquals(out, null);
});

Deno.test("diagnose — a degraded empty-candidate diagnosis is non-null", async () => {
  const degraded: StructuredDiagnosis = {
    candidate_systems: [], recommended_tests: [], safety_flags: [], to_confirm: [], narrative: "",
  };
  const out = await diagnose({ vehicle: {}, symptom: "x" }, () => Promise.resolve(degraded));
  assert(out !== null);
  assertEquals(out!.candidate_systems.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test apps/agent/src/common/fixo-diagnose_test.ts`
Expected: FAIL — `Module not found "./fixo-diagnose.ts"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/agent/src/common/fixo-diagnose.ts
import { diagnoseStructured, type StructuredDiagnosis } from "../fixo/diagnose-structured.ts";
import type { DiagnoseOnceInput } from "../fixo/run-once-prompt.ts";

export interface DiagnoseInput {
  vehicle: { year?: number | string; make?: string; model?: string };
  symptom: string;
  dtcs?: string[];
  /** Reserved for the vision fast-follow; ignored in v1 (maps to DiagnoseRequest.photoUrls later). */
  imageRefs?: string[];
}

/**
 * Contract-decoupled client for the Fixo brain. v1 transport = the in-process,
 * NON-persisting diagnoseStructured (no fixo_predictions row). To externalize,
 * replace ONLY the default `run` with an HTTP /v1/mcp diagnose call.
 *
 * Best-effort: returns null on any thrown failure (brain/DB) — never throws.
 * A degraded empty-candidate diagnosis is a NON-null success; callers treat an
 * empty to_confirm as "no useful follow-ups", not an error.
 */
export async function diagnose(
  input: DiagnoseInput,
  run: (i: DiagnoseOnceInput) => Promise<StructuredDiagnosis> = diagnoseStructured,
): Promise<StructuredDiagnosis | null> {
  try {
    // imageRefs intentionally dropped in v1 (DiagnoseOnceInput has no image field).
    return await run({
      vehicle: {
        year: input.vehicle.year ?? "",
        make: input.vehicle.make ?? "",
        model: input.vehicle.model ?? "",
      },
      symptom: input.symptom,
      dtcs: input.dtcs,
    });
  } catch (err) {
    console.error("diagnose() failed:", String(err));
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test apps/agent/src/common/fixo-diagnose_test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Format + commit**

```bash
deno fmt apps/agent/src/common/fixo-diagnose.ts apps/agent/src/common/fixo-diagnose_test.ts
git add apps/agent/src/common/fixo-diagnose.ts apps/agent/src/common/fixo-diagnose_test.ts
git commit -m "feat(agent): diagnose() client — contract-decoupled, non-persisting, null-safe"
```

---

### Task 2: `diagnose_symptom` tool + register

**Files:**
- Create: `apps/agent/src/hmls/tools/diagnose-symptom.ts`
- Test: `apps/agent/src/hmls/tools/diagnose-symptom_test.ts`
- Modify: `apps/agent/src/hmls/agent.ts:11-15` (import), `:62-70` (allTools array)

**Interfaces:**
- Consumes: `diagnose`, `DiagnoseInput` from `../../common/fixo-diagnose.ts`; `StructuredDiagnosis` from `../../fixo/diagnose-structured.ts`; `toolResult` from `@hmls/shared/tool-result`; `LegacyTool` from `../../common/convert-tools.ts`.
- Produces: `export const diagnoseSymptomTools: LegacyTool[]`; `export function shapeDiagnosis(d: StructuredDiagnosis | null)` returning `{ available: false } | { available: true; toConfirm; safetyFlags; internalScope: { candidateSystems; recommendedTests; likelyRootCause } }` (NO prediction id).

- [ ] **Step 1: Write the failing test (pure shaping logic)**

```ts
// apps/agent/src/hmls/tools/diagnose-symptom_test.ts
import { assert, assertEquals } from "@std/assert";
import { shapeDiagnosis } from "./diagnose-symptom.ts";
import type { StructuredDiagnosis } from "../../fixo/diagnose-structured.ts";

const D: StructuredDiagnosis = {
  candidate_systems: [{ system: "brakes", confidence: 3, reasons: ["grinding"] }],
  likely_root_cause: "worn pads + scored rotor",
  recommended_tests: ["measure pad thickness"],
  safety_flags: ["Grinding can mean metal-on-metal — advise caution braking."],
  to_confirm: ["Front, rear, or both?"],
  narrative: "Front brake wear.",
};

Deno.test("shapeDiagnosis — null → available:false, no prediction id", () => {
  const out = shapeDiagnosis(null);
  assertEquals(out, { available: false });
  assert(!("predictionId" in out) && !("prediction_id" in out));
});

Deno.test("shapeDiagnosis — curated shape, internalScope present, no prediction id", () => {
  const out = shapeDiagnosis(D);
  assert(out.available === true);
  assertEquals(out.toConfirm, ["Front, rear, or both?"]);
  assertEquals(out.safetyFlags, D.safety_flags);
  assertEquals(out.internalScope.candidateSystems, D.candidate_systems);
  assertEquals(out.internalScope.recommendedTests, D.recommended_tests);
  assertEquals(out.internalScope.likelyRootCause, "worn pads + scored rotor");
  assert(!("predictionId" in out) && !("prediction_id" in out));
});

Deno.test("shapeDiagnosis — missing likely_root_cause → null", () => {
  const out = shapeDiagnosis({ ...D, likely_root_cause: undefined });
  assert(out.available === true);
  assertEquals(out.internalScope.likelyRootCause, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test apps/agent/src/hmls/tools/diagnose-symptom_test.ts`
Expected: FAIL — `Module not found "./diagnose-symptom.ts"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/agent/src/hmls/tools/diagnose-symptom.ts
import { z } from "zod";
import { toolResult } from "@hmls/shared/tool-result";
import { diagnose } from "../../common/fixo-diagnose.ts";
import type { StructuredDiagnosis } from "../../fixo/diagnose-structured.ts";
import type { LegacyTool } from "../../common/convert-tools.ts";

/** Pure: curate a StructuredDiagnosis into the agent-facing result. SHOP-ONLY
 *  fields live under internalScope; there is intentionally NO prediction id
 *  (this path is non-persisting; create_order owns the persisted prediction). */
export function shapeDiagnosis(d: StructuredDiagnosis | null) {
  if (!d) return { available: false as const };
  return {
    available: true as const,
    toConfirm: d.to_confirm,
    safetyFlags: d.safety_flags,
    internalScope: {
      candidateSystems: d.candidate_systems,
      recommendedTests: d.recommended_tests,
      likelyRootCause: d.likely_root_cause ?? null,
    },
  };
}

const diagnoseSymptomTool: LegacyTool = {
  name: "diagnose_symptom",
  description:
    "Run the repair-diagnosis brain on a vehicle + symptom BEFORE the labor/parts lookups and " +
    "create_order. Use for repair/diagnostic cases (noise, warning light, leak, anything wrong) — " +
    "NOT routine maintenance (oil change, rotation, filter). Returns: toConfirm (follow-up " +
    "questions to ask the customer), safetyFlags (you MAY relay these as a plain caution), and " +
    "internalScope (candidate systems, recommended tests, likely root cause). internalScope is " +
    "SHOP-ONLY: use it to choose/scope services, but NEVER recite candidate systems or the likely " +
    "root cause to the customer. If available is false, just continue intake normally.",
  schema: z.object({
    vehicle: z.object({
      year: z.union([z.number(), z.string()]).optional(),
      make: z.string().optional(),
      model: z.string().optional(),
    }),
    symptom: z.string().min(1),
    dtcs: z.array(z.string()).optional().describe("OBD codes if the customer read them (rare)."),
  }),
  execute: async (params: { vehicle: { year?: number | string; make?: string; model?: string }; symptom: string; dtcs?: string[] }) => {
    const d = await diagnose({ vehicle: params.vehicle, symptom: params.symptom, dtcs: params.dtcs });
    return toolResult({ success: true, ...shapeDiagnosis(d) });
  },
};

export const diagnoseSymptomTools: LegacyTool[] = [diagnoseSymptomTool];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test apps/agent/src/hmls/tools/diagnose-symptom_test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the tool in the customer agent**

In `apps/agent/src/hmls/agent.ts`, add the import after line 16 (`import { scheduleTools } ...`):

```ts
import { diagnoseSymptomTools } from "./tools/diagnose-symptom.ts";
```

Then add it to the `allTools` array (currently lines 62-70) — place it FIRST so it precedes the lookups/order tools:

```ts
  const allTools: LegacyTool[] = [
    ...diagnoseSymptomTools,
    ...askUserQuestionTools,
    ...orderTools,
    ...schedulingTools,
    ...scheduleTools,
    ...laborLookupTools,
    ...partsLookupTools,
    ...customerOrderTools,
  ];
```

- [ ] **Step 6: Verify the agent still type-checks and the tool is registered**

Run: `deno check apps/agent/src/hmls/agent.ts`
Expected: PASS, no errors.

- [ ] **Step 7: Format + commit**

```bash
deno fmt apps/agent/src/hmls/tools/diagnose-symptom.ts apps/agent/src/hmls/tools/diagnose-symptom_test.ts apps/agent/src/hmls/agent.ts
git add apps/agent/src/hmls/tools/diagnose-symptom.ts apps/agent/src/hmls/tools/diagnose-symptom_test.ts apps/agent/src/hmls/agent.ts
git commit -m "feat(agent): diagnose_symptom tool (shop-only diagnosis) + register on customer agent"
```

---

### Task 3: System-prompt — make the agent diagnose first

**Files:**
- Modify: `apps/agent/src/hmls/system-prompt.ts:39-42` (repair branch), `:66-69` (tool-call discipline)

**Interfaces:**
- Consumes: the `diagnose_symptom` tool registered in Task 2 (`toConfirm`, `safetyFlags`, `internalScope`, `available`).
- Produces: prompt text only — no code symbols.

This task is prose edits to the system prompt. There is no unit test; Task 4's eval verifies the behavior end to end.

- [ ] **Step 1: Replace the "For repair / diagnostic" numbered list (lines 39-42)**

Find:

```
**For repair / diagnostic** (brakes making noise, check-engine light, fluid leak, anything sounding off):
1. Acknowledge briefly and ask about the symptom FIRST. The customer came here because something's wrong — meet them where they are. Example: "Got it — what's it doing? Squealing, grinding, vibrating when you stop, anything like that? Front, rear, or both?" That's it for this turn. No logistics yet.
2. After they describe the issue, give a quick read on what it likely is in plain language ("sounds like the front pads are worn — common at 60–80k miles"). Then ask logistics in ONE casual sentence: "Where would you like us to come to, and anything we should know to get to the car (gate code, parking)?"
3. Then run the lookups + `create_order` and show the estimate.
```

Replace with:

```
**For repair / diagnostic** (brakes making noise, check-engine light, fluid leak, anything sounding off):
1. Acknowledge briefly and ask about the symptom FIRST. The customer came here because something's wrong — meet them where they are. Example: "Got it — what's it doing? Squealing, grinding, vibrating when you stop, anything like that? Front, rear, or both?" That's it for this turn. No logistics yet.
2. After they describe the issue, call `diagnose_symptom` (vehicle + symptom + any OBD codes) to get the expert read. Then in ONE casual turn: give a quick plain-language read on what it likely is, ask the single most useful follow-up from `toConfirm`, and fold in logistics: "Where would you like us to come to, and anything we should know to get to the car (gate code, parking)?" If `safetyFlags` is non-empty, lead with a brief plain caution ("if the pedal feels soft, please don't drive it until we look"). NEVER recite the candidate systems or likely root cause from `internalScope` — that's for the shop; use it only to pick the right services. If `available` is false, just proceed as before.
3. Next turn, run the lookups + `create_order` (scoping services using `internalScope`) and show the estimate.
```

- [ ] **Step 2: Add a `diagnose_symptom` discipline bullet (after line 68, the `get_order_status` bullet)**

Find the line:

```
- `get_order_status` should run at most once per customer per turn.
```

Add immediately after it:

```
- `diagnose_symptom` runs AT MOST ONCE per intake, and ONLY for a repair/diagnostic symptom — never for routine maintenance (oil change, rotation, filter). It does not render in the customer's chat; its `internalScope` (candidate systems, root cause) is shop-only and must never appear in your text to the customer.
```

- [ ] **Step 3: Verify the prompt still loads (agent boot smoke check)**

Run: `deno check apps/agent/src/hmls/system-prompt.ts apps/agent/src/hmls/agent.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
deno fmt apps/agent/src/hmls/system-prompt.ts
git add apps/agent/src/hmls/system-prompt.ts
git commit -m "feat(agent): prompt — diagnose_symptom first on repair intake, internalScope shop-only"
```

---

### Task 4: Intake behavior eval (real model)

**Files:**
- Create: `apps/agent/src/scripts/intake-eval.ts`

**Interfaces:**
- Consumes: `runHmlsAgent` from `../hmls/agent.ts`; `GOOGLE_API_KEY` + `DATABASE_URL` from env (via Infisical).
- Produces: a runnable script (not a CI unit test) that prints PASS/FAIL per check and exits non-zero on any failure.

This is a real-model eval (like `fixo-eval --real`): it hits Gemini and the OLP/DB. It is the hard gate for the two behaviors unit tests can't cover — tool-call ORDER and the no-leak guarantee. Note: a repair scenario may cause `create_order` to write a `draft` row; phrase scenarios WITHOUT a service address so `create_order` returns `missingFields` and writes nothing, OR accept + clean up the test draft.

- [ ] **Step 1: Write the eval script**

```ts
// apps/agent/src/scripts/intake-eval.ts
//
// Intake-behavior eval for the HMLS customer agent. Runs runHmlsAgent on a
// scripted single turn and checks: (1) repair symptom → diagnose_symptom is
// called BEFORE create_order; (2) the assistant TEXT never leaks internalScope
// jargon (candidate-system / root-cause terms); (3) maintenance → diagnose_symptom
// is NOT called. Real model + OLP DB.
//
// Run: infisical run --env=dev -- deno run -A apps/agent/src/scripts/intake-eval.ts
import { runHmlsAgent } from "../hmls/agent.ts";

const apiKey = Deno.env.get("GOOGLE_API_KEY");
if (!apiKey) {
  console.error("GOOGLE_API_KEY required (run via infisical).");
  Deno.exit(2);
}

interface Trace { toolOrder: string[]; text: string }

async function runTurn(prompt: string): Promise<Trace> {
  const result = runHmlsAgent({
    messages: [{ role: "user", content: prompt }],
    config: { googleApiKey: apiKey! },
  });
  const toolOrder: string[] = [];
  let text = "";
  for await (const part of result.fullStream) {
    // deno-lint-ignore no-explicit-any
    const p = part as any;
    if (p.type === "tool-call" && p.toolName) toolOrder.push(p.toolName as string);
    if (p.type === "text-delta" && typeof p.text === "string") text += p.text;
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
  check("repair: no internalScope leak in assistant text", leaked.length === 0, `leaked=${leaked.join(",")}`);
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
```

- [ ] **Step 2: Run the eval**

Run: `infisical run --env=dev -- deno run -A apps/agent/src/scripts/intake-eval.ts`
Expected: `ALL CHECKS PASSED`. If the repair scenario fails "diagnose_symptom is called", the prompt precondition (Task 3) is losing to the one-turn-pipeline instruction — strengthen the Task 3 step-2 wording and re-run. If a leak term appears, tighten the `internalScope` shop-only wording.

- [ ] **Step 3: Commit**

```bash
deno fmt apps/agent/src/scripts/intake-eval.ts
git add apps/agent/src/scripts/intake-eval.ts
git commit -m "test(agent): intake eval — diagnose_symptom ordering + no internalScope leak"
```

---

## Final verification

- [ ] `deno fmt --check apps/agent/src` + `deno lint apps/agent/src` clean.
- [ ] `deno test apps/agent/src/common/fixo-diagnose_test.ts apps/agent/src/hmls/tools/diagnose-symptom_test.ts` — all pass.
- [ ] `deno check apps/agent/src/hmls/agent.ts` — passes.
- [ ] No-regression: existing `create_order` / order tests still pass (`deno test apps/agent/src/common/tools/`); `create_order` is unchanged.
- [ ] `infisical run --env=dev -- deno run -A apps/agent/src/scripts/intake-eval.ts` — `ALL CHECKS PASSED`.
- [ ] Manual: open the customer chat, describe a brake symptom, confirm the agent asks a sharper follow-up + (if any) a safety caution, and that no diagnosis pill renders and no candidate-system jargon appears in its reply.

## What this plan does NOT touch

- `create_order` and its fire-and-forget prediction persistence — unchanged.
- The outcome loop (`recordOutcome` via the `confirmedDiagnosis` PATCH) — unchanged; do not add a second call at the `completed` transition.
- Photo/vision (the `imageRefs` field is reserved + dropped), multi-tenancy, scheduling, HTTP transport — all out of scope.
