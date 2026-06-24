# Live diagnosis in intake — wiring the Fixo brain into HMLS auto-intake

**Date:** 2026-06-23  **Status:** Design — awaiting review  **Branch:** spinsirr/friendly-wu-81226a

## Context

HMLS's wedge is agent-native intake + (later) agentic scheduling, not order management
(a red ocean). The auto-intake flow exists (~70%): the customer chat agent collects
vehicle + symptom + photos, calls `lookup_labor_time` (OLP) + `lookup_parts_price`
(RockAuto), and writes a priced `draft` order. Photos land in `order_intake.photoUrls`
but are never analyzed. "Diagnosis" today is just the agent paraphrasing the customer.

Fixo's repair brain is already a deployed, decoupled capability. `diagnoseForApi()`
(in-process) and the public `POST /v1/mcp` `diagnose` tool both return
`{ prediction_id, diagnosis }` where `diagnosis` is a `StructuredDiagnosis`. There is a
`record_outcome` to close the loop. HMLS already mints a `prediction_id` and stamps
`orders.fixo_prediction_id`, but the brain runs **fire-and-forget AFTER the draft is
created** ([order.ts:744-779](apps/agent/src/common/tools/order.ts)) — the agent never
sees the diagnosis, so it does nothing for the conversation.

**This change turns the diagnosis into a live participant in intake:** the agent calls
the brain DURING the conversation, before pricing, and uses the result to ask the right
follow-up questions, surface safety warnings, and sharpen the order scope — then reuses
that prediction on the order.

### Locked decisions (from brainstorming, 2026-06-23)

1. **Audience (internal-first).** The agent uses the diagnosis to ask follow-ups and
   sharpen scope; the full structured diagnosis goes to the shop on the draft. The
   customer sees a tighter estimate + clarifying questions, NOT the speculative
   `likely_root_cause` / `candidate_systems`. **Exception:** `safety_flags` DO surface to
   the customer, phrased as caution ("if the brake pedal feels soft, please don't drive
   it until we look") — a safety warning is a duty, not a speculative diagnosis.
2. **Boundary (contract-decoupled, in-process transport).** Calls go through one
   `diagnose()` client shaped to the public `StructuredDiagnosis` contract. Today it calls
   `diagnoseForApi()` in-process; swapping to the HTTP `/v1/mcp diagnose` API later is a
   one-place transport change. Decoupling is enforced by the contract, not paid for now
   as loopback HTTP while HMLS and Fixo share a process.
3. **Input scope (text + DTC for v1).** v1 diagnoses from `symptom` text + optional
   `dtcs`, using the shipped contract as-is. The `diagnose()` contract reserves an
   optional `imageRefs` field (ignored in v1) so photo/vision is a drop-in fast-follow,
   not a contract rewrite. Photos keep landing in `order_intake.photoUrls` for shop review.

## Goals

- The intake agent asks symptom-appropriate follow-up questions driven by the brain's
  `to_confirm`, instead of generic ones.
- Safety-critical conditions reach the customer as a caution.
- The shop sees a structured diagnosis on the draft (already readable via
  [orders.ts:360](apps/gateway/src/routes/orders.ts)), giving the reviewer a head start.
- One prediction per intake — no double brain run. The order links the prediction the
  agent already made.
- The diagnose call is best-effort and never blocks or breaks order creation.

## Non-goals (v1)

- Photo/vision in the diagnosis (contract reserves `imageRefs`; ignored).
- Showing the speculative diagnosis (`candidate_systems`, `likely_root_cause`) to the
  customer.
- Swapping the transport to real HTTP (`diagnose()` stays in-process; seam is in place).
- Multi-tenancy Phase A and agentic scheduling (separate tracks, deferred).

## Current state (verified)

- HMLS customer agent tools ([agent.ts:59-67](apps/agent/src/hmls/agent.ts)): `ask_user_question`,
  `create_order`, `get_order`, `lookup_labor_time`, `list_vehicle_services`,
  `lookup_parts_price`, `get_availability`, `schedule_order`, `get_order_status`,
  `add_order_note`, `cancel_order`, `modify_order_items`, `cancel_booking`. **No diagnosis tool.**
- `create_order` ([order.ts:744-779](apps/agent/src/common/tools/order.ts)): on a symptom,
  `openPrediction()` mints an id, `fillPrediction()` runs the brain fire-and-forget,
  `recordEstimate()` attaches the priced estimate, `orders.fixo_prediction_id` is stamped.
  All best-effort, none of it informs the conversation.
- `diagnoseForApi()` (apps/agent/src/fixo, exported via mod) returns `{ predictionId,
  diagnosis: StructuredDiagnosis }` in one synchronous ~5s agent run.
- `StructuredDiagnosis`: `{ candidate_systems[], likely_root_cause?, recommended_tests[],
  safety_flags[], to_confirm[], narrative }`.
- `record_outcome` / `recordOutcome` exists (Fixo MCP + lib). Whether HMLS's
  order-completion path calls it on confirm is **to be verified during planning**.

## Design

### 1. `diagnose()` client — `apps/agent/src/common/fixo-diagnose.ts` (new)

```
diagnose(input: {
  vehicle: { year; make; model };
  symptom: string;
  dtcs?: string[];
  imageRefs?: string[];   // reserved; ignored in v1
}): Promise<{ predictionId: string; diagnosis: StructuredDiagnosis } | null>
```

- v1 transport: calls `diagnoseForApi({ vehicle, symptom, dtcs })` in-process.
- Returns `null` on any failure (timeout, brain error) — caller treats null as "no
  diagnosis available" and proceeds. Never throws.
- The single seam to swap for HTTP `/v1/mcp diagnose` later. `imageRefs` is accepted and
  dropped now; wiring it to vision is the fast-follow.

### 2. `diagnose_symptom` agent tool — `apps/agent/src/hmls/tools/diagnose-symptom.ts` (new)

Added to the HMLS customer agent tool list ([agent.ts:59-67](apps/agent/src/hmls/agent.ts)).

- **Input:** `{ vehicle, symptom, dtcs? }`.
- **Behavior:** calls `diagnose()`. On a result, returns to the agent a curated view:
  - `predictionId` — the agent passes this to `create_order`.
  - `toConfirm: string[]` — questions to ask the customer.
  - `safetyFlags: string[]` — surfaced to the customer as caution.
  - `internalScope: { candidateSystems, recommendedTests, likelyRootCause }` — the tool
    description and system prompt instruct the agent to use these to scope the order but
    NOT to recite them to the customer.
- On `null`: returns `{ available: false }`; the agent continues intake normally.

### 3. System prompt — `apps/agent/src/hmls/system-prompt.ts`

- When the customer describes a symptom for a repair/diagnostic service (not routine
  maintenance), call `diagnose_symptom` once, BEFORE finalizing pricing/`create_order`.
- Ask the `toConfirm` questions via `ask_user_question`.
- If `safetyFlags` is non-empty, give a plain cautionary message to the customer.
- Use `internalScope` to choose/scope services; do NOT recite candidate systems or root
  cause to the customer.
- Pass the returned `predictionId` into `create_order`.

### 4. `create_order` reuse path — `apps/agent/src/common/tools/order.ts`

- Add optional `predictionId` param.
- If provided: skip `openPrediction()` + `fillPrediction()`; stamp the given id, and run
  `recordEstimate()` against it (estimate-vs-actual calibration unchanged).
- If absent (staff walk-in, or agent skipped diagnose): keep today's fire-and-forget
  behavior verbatim — zero regression.
- Net effect: exactly one brain run per intake; the conversation drove it.

### 5. Loop back-half — `record_outcome` on completion

Verify whether the order-completion path (mechanic confirms the actual repair) calls
`recordOutcome(predictionId, confirmed_diagnosis, actual_cost_cents)`. If not, add a thin
call at the `completed` transition so the loop closes and the brain's accuracy is scored.
Scoped in the implementation plan after verification.

### Data flow

```
Customer: "2019 Accord, shakes at idle, check-engine light on"
  │
  ▼  agent has vehicle + symptom
diagnose_symptom(vehicle, symptom, dtcs?)
  │
  ▼  diagnose() ──(in-process today; HTTP later)──► diagnoseForApi()
  │                                                  mint predictionId, run brain ~5s
  ◄─ { predictionId, diagnosis }   (null on failure → intake continues)
  │
  ├─ toConfirm     → ask_user_question follow-ups
  ├─ safetyFlags   → cautionary message to customer
  └─ internalScope → choose/scope services   (NOT recited to customer)
  │
  ▼
create_order(..., predictionId)   ← reuse: stamp fixo_prediction_id + recordEstimate
  │                                  draft; shop review sees full structured diagnosis
  ▼  (job completes, mechanic confirms)
record_outcome(predictionId, confirmed_diagnosis, actual_cost)   ← closes loop
```

## Error handling

- `diagnose()` returns `null` on timeout/error; `diagnose_symptom` returns
  `{ available: false }`; intake proceeds exactly as today (collect → price → draft).
- A `diagnose_symptom` call adds ~5s to one turn. The agent should acknowledge ("let me
  look into that") so the wait reads as work, not a hang.
- `create_order` with a stale/invalid `predictionId` still creates the order; the
  `recordEstimate` link is best-effort (logged, non-fatal), matching today's pattern.

## Testing

- **`diagnose()` client (unit):** maps input → `diagnoseForApi`; returns the structured
  shape; returns `null` on thrown error; drops `imageRefs` without error.
- **`diagnose_symptom` tool (unit):** result → curated `{ predictionId, toConfirm,
  safetyFlags, internalScope }`; `null` → `{ available: false }`.
- **`create_order` reuse (unit):** with `predictionId` → no `openPrediction`/
  `fillPrediction`, stamps the id, runs `recordEstimate`; without → fire-and-forget path
  unchanged (regression guard).
- **Intake behavior (eval, [→EVAL]):** given a symptom prompt, the agent calls
  `diagnose_symptom` before `create_order`, asks a `toConfirm` question, surfaces a
  safety flag when present, and does NOT recite candidate systems to the customer. Eval
  harness: `apps/agent/src/scripts/fixo-eval.ts` pattern.
- **Loop (integration):** completing an order with a `fixo_prediction_id` calls
  `record_outcome` (add after verifying current wiring).

## Rollout

- N=1 on the dogfood mobile-mechanic shop. Behind no flag needed — the path is additive
  and best-effort; if the brain is down, intake degrades to today's behavior.
- Watch: does the agent over-call `diagnose_symptom` (cost/latency)? The "once, before
  create_order, repair/diagnostic only" prompt rule bounds it; verify in the eval.
