# Live diagnosis in intake — wiring the Fixo brain into HMLS auto-intake

**Date:** 2026-06-23 **Status:** Design — revised after adversarial verification **Branch:**
spinsirr/friendly-wu-81226a

## Context

HMLS's wedge is agent-native intake + (later) agentic scheduling, not order management (a red
ocean). The auto-intake flow exists (~70%): the customer chat agent collects vehicle + symptom +
photos, calls `lookup_labor_time` (OLP) + `lookup_parts_price` (RockAuto), and writes a priced
`draft` order. Photos land in `order_intake.photoUrls` but are never analyzed. "Diagnosis" today is
just the agent paraphrasing the customer.

Fixo's repair brain is already a deployed, decoupled capability. `diagnoseStructured()` runs the
brain for one stateless turn and returns a `StructuredDiagnosis`; `diagnoseForApi()` wraps it to
also persist a `fixo_predictions` row and return `{ prediction_id, diagnosis }`. `recordOutcome()`
closes the loop. HMLS already mints a `prediction_id` and stamps `orders.fixo_prediction_id`, but
the brain runs **fire-and-forget AFTER the draft is created**
([order.ts:744-779](apps/agent/src/common/tools/order.ts)) — the agent never sees the diagnosis, so
it does nothing for the conversation.

**This change gives the agent a diagnosis DURING intake** so it asks the right follow-up questions
and surfaces safety warnings before the order is drafted. The persisted prediction-of-record and the
outcome loop are left exactly as they already work.

### Locked decisions (brainstorming 2026-06-23, refined by verification)

1. **Audience (internal-first).** The agent uses the diagnosis to ask follow-ups and sharpen scope;
   the full structured diagnosis reaches the shop via the existing draft readback
   ([orders.ts:360](apps/gateway/src/routes/orders.ts)). The customer sees a tighter estimate +
   clarifying questions, NOT the speculative `likely_root_cause` / `candidate_systems`.
   **Exception:** `safety_flags` DO reach the customer, phrased as caution — a safety warning is a
   duty, not a speculative diagnosis.
2. **Boundary (contract-decoupled, in-process transport).** Calls go through one `diagnose()` client
   shaped to the `StructuredDiagnosis` contract. Today it calls the in-process brain; swapping to
   the HTTP `/v1/mcp diagnose` API later is a one-place transport change.
3. **Input scope (text + DTC for v1).** v1 diagnoses from `symptom` text + optional `dtcs`. The
   `diagnose()` client reserves an optional `imageRefs` field (ignored in v1) so photo/vision is a
   drop-in fast-follow. (Note: the underlying `DiagnoseRequest` carries `photoUrls`, not `imageRefs`
   — the client maps onto it; reconcile the name when vision lands.) Photos keep landing in
   `order_intake.photoUrls` for shop review.
4. **No cross-turn id threading (verification-driven).** Because follow-up questions go through
   `ask_user_question`, which is in the agent's `stopWhen`
   ([agent.ts:84](apps/agent/src/hmls/agent.ts)), the turn ends after the agent asks — so a
   diagnosis tool and `create_order` are always in different turns. We do NOT make the agent carry a
   `prediction_id` across that boundary (models drop opaque ids). The conversational diagnosis and
   the persisted prediction-of-record are decoupled (see Design): the diagnose tool is
   non-persisting; `create_order`'s existing fire-and-forget persistence is untouched.

## Goals

- The intake agent asks symptom-appropriate follow-up questions driven by the brain's `to_confirm`,
  instead of generic ones.
- Safety-critical conditions reach the customer as a caution.
- The shop sees a structured diagnosis on the draft (already wired).
- The outcome loop (already wired) keeps scoring predictions; v1 changes nothing there.
- Best-effort: a brain failure never blocks or breaks intake or order creation.

## Non-goals (v1)

- Photo/vision in the diagnosis (client reserves `imageRefs`; ignored).
- Showing speculative diagnosis (`candidate_systems`, `likely_root_cause`) to the customer.
- Swapping the transport to real HTTP (seam in place; stays in-process).
- Any change to `create_order`'s prediction persistence or to the `record_outcome` loop.
- A `prediction_id` param on `create_order` (the original draft proposed this; verification showed
  it is both fragile and unnecessary — dropped).
- Multi-tenancy Phase A and agentic scheduling (separate tracks, deferred).

## Current state (verified against code)

- HMLS customer agent tools ([agent.ts:59-67](apps/agent/src/hmls/agent.ts)): `ask_user_question`,
  `create_order`, `get_order`, `lookup_labor_time`, `list_vehicle_services`, `lookup_parts_price`,
  `get_availability`, `schedule_order`, `get_order_status`, `add_order_note`, `cancel_order`,
  `modify_order_items`, `cancel_booking`. **No diagnosis tool.**
- `stopWhen: [stepCountIs(25), hasToolCall("ask_user_question")]`
  ([agent.ts:84](apps/agent/src/hmls/agent.ts)) — asking via `ask_user_question` ends the turn.
- `ToolContext` ([convert-tools.ts:1](apps/agent/src/common/convert-tools.ts)) carries only
  `customerId` + `shopId` — **no conversation/session id**, so a server-side per-conversation
  prediction cache is not cheaply available (would need new plumbing). This is why v1 uses two
  decoupled brain runs rather than a cache.
- `create_order` ([order.ts:744-779](apps/agent/src/common/tools/order.ts)): on a symptom,
  `openPrediction()` mints the id, `fillPrediction()` runs the brain fire-and-forget,
  `recordEstimate()` attaches the estimate, `orders.fixo_prediction_id` is stamped. Stays as-is.
- `diagnoseStructured()` ([diagnose-structured.ts](apps/agent/src/fixo/diagnose-structured.ts)) —
  one stateless brain turn, no userId/session, no persistence, no credits. **This is what the
  diagnose tool calls.** Degrades to a minimal valid diagnosis instead of throwing.
- `diagnoseForApi()` ([fixo-brain.ts:77-92](apps/agent/src/fixo/fixo-brain.ts)) — persisting
  wrapper, exported via [mod.ts:78](apps/agent/src/mod.ts). Not used by this change.
- `StructuredDiagnosis` ([diagnosis-schema.ts:3-21](apps/agent/src/fixo/diagnosis-schema.ts)):
  `{ candidate_systems[], likely_root_cause?, recommended_tests[], safety_flags[], to_confirm[], narrative }`.
- **Outcome loop — VERIFIED WIRED (do not re-add).** `recordOutcome` fires from the
  `confirmedDiagnosis` PATCH ([orders.ts:361-370](apps/gateway/src/routes/orders.ts)), gated on
  `latest.fixoPredictionId`, fire-and-forget. The web `complete_job` action saves the confirmed
  diagnosis (firing the PATCH) right before transitioning to `completed`
  ([order-actions.ts:168-191](apps/hmls-web/lib/order-actions.ts),
  [useOrderMutations.ts:121-134](apps/hmls-web/hooks/useOrderMutations.ts)). HMLS in-process
  predictions are null-owner, so the ownership check passes. The `completed` status transition
  itself ([order-state.ts] / PATCH `/:id/status`) does NOT call `recordOutcome` — adding one there
  would double-fire.

## Design

### 1. `diagnose()` client — `apps/agent/src/common/fixo-diagnose.ts` (new)

```
diagnose(input: {
  vehicle: { year?; make?; model? };
  symptom: string;
  dtcs?: string[];
  imageRefs?: string[];   // reserved; ignored in v1 (maps to DiagnoseRequest.photoUrls later)
}): Promise<StructuredDiagnosis | null>
```

- v1 transport: calls `diagnoseStructured({ vehicle, symptom, dtcs })` in-process —
  **non-persisting** (no `fixo_predictions` row). Returns the diagnosis only.
- Returns `null` on a thrown error (brain/DB failure) — never throws. A _degraded but valid_
  diagnosis (empty `candidate_systems` / empty `to_confirm`) is a NON-null success; callers treat
  empty arrays as "no useful follow-ups", not an error.
- The single seam to swap for HTTP `/v1/mcp diagnose` later. `imageRefs` accepted and dropped now;
  wiring it to vision (mapping onto `photoUrls`) is the fast-follow.

### 2. `diagnose_symptom` agent tool — `apps/agent/src/hmls/tools/diagnose-symptom.ts` (new)

Added to the HMLS customer agent tool list ([agent.ts:59-67](apps/agent/src/hmls/agent.ts)).

- **Input:** `{ vehicle, symptom, dtcs? }`.
- **Behavior:** calls `diagnose()`. On a result, returns to the agent:
  - `toConfirm: string[]` — questions to ask the customer.
  - `safetyFlags: string[]` — surfaced to the customer as caution.
  - `internalScope: { candidateSystems, recommendedTests, likelyRootCause }` — under a key the tool
    description marks **"shop-only — never echo to the customer"**; the agent uses it to scope
    services, not to recite.
  - No `prediction_id` (non-persisting; nothing to thread).
- On `null`: returns `{ available: false }`; the agent continues intake normally.

### 3. System prompt — `apps/agent/src/hmls/system-prompt.ts`

- Insert the new rule **as a precondition inside the existing "run the full pipeline in one turn"
  block** (system-prompt.ts:59-69), NOT appended elsewhere — otherwise the pipeline instruction wins
  and the diagnosis is skipped: "For a repair/diagnostic symptom (not routine maintenance), call
  `diagnose_symptom` FIRST, before the OLP/parts lookups."
- Ask the `toConfirm` questions via `ask_user_question` (this ends the turn — expected).
- If `safetyFlags` is non-empty, give a plain cautionary message to the customer.
- Use `internalScope` to choose/scope services; NEVER recite candidate systems or root cause to the
  customer.

### 4. `create_order` — UNCHANGED

No `prediction_id` param, no reuse path. Its existing fire-and-forget
`openPrediction`/`fillPrediction`/`recordEstimate`/stamp
([order.ts:744-779](apps/agent/src/common/tools/order.ts)) remains the persisted
prediction-of-record and continues to feed the outcome loop. When the customer revises after
follow-ups, `create_order` runs with the enriched symptom, so the persisted prediction reflects the
final intake.

**Tradeoff (accepted):** a diagnostic intake runs the brain twice — once non-persisting in
`diagnose_symptom` (drives the conversation, ~5s, blocks the one turn the agent says "let me look
into that") and once fire-and-forget in `create_order` (the persisted record). At N=1 this is fine;
if cost matters, a later optimization adds a per-conversation cache (needs a conversation id
threaded into `ToolContext`) or HTTP persistence reuse.
`// ponytail: two brain runs per intake; add a conversation-keyed cache if cost bites.`

### 5. Outcome loop — NO CHANGE (already wired)

`recordOutcome` already fires from the `confirmedDiagnosis` PATCH for HMLS orders carrying a
`fixo_prediction_id` ([orders.ts:361-370](apps/gateway/src/routes/orders.ts)). v1 adds nothing here.
**Do not** add a `recordOutcome` call at the `completed` transition — it would double-fire. Optional
hardening (separate, out of v1 scope): the PATCH uses
`actualCostCents = paidAmountCents ?? subtotalCents`, so an unpaid completed order records the
_estimate_ as the actual cost, polluting calibration — guard against unpaid.

### Data flow

```
Turn 1  Customer: "2019 Accord, shakes at idle, check-engine light on"
   │  agent (repair/diagnostic symptom) calls diagnose_symptom(vehicle, symptom, dtcs?)
   ▼
   diagnose() ──(in-process diagnoseStructured; HTTP later)──► brain ~5s, NO persistence
   ◄─ StructuredDiagnosis | null
   │   toConfirm   → ask_user_question  ──► TURN ENDS (stopWhen)
   │   safetyFlags → cautionary message
   │   internalScope → (held for scoping; never recited)
   ▼
Turn 2  Customer answers the follow-ups
   │  agent calls create_order(... enriched symptom ...)   ← UNCHANGED
   ▼  fire-and-forget openPrediction/fillPrediction → persisted prediction-of-record
      stamp orders.fixo_prediction_id; draft; shop review sees full diagnosis
   ...
   (job completes) web complete_job → save confirmedDiagnosis (PATCH) → recordOutcome  ← already wired
```

## Error handling

- `diagnose()` returns `null` on thrown error (brain/DB); `diagnose_symptom` returns
  `{ available: false }`; intake proceeds exactly as today.
- A degraded valid diagnosis (empty candidates/to_confirm) is non-null; the agent treats empty
  `toConfirm` as "no extra questions" and moves on.
- `diagnose_symptom` blocks ~5s on its turn; the agent acknowledges ("let me look into that") so the
  wait reads as work.
- `create_order` persistence stays best-effort/fire-and-forget (logged, non-fatal) — no regression.

## Testing

- **`diagnose()` client (unit):** maps input → `diagnoseStructured`; returns the structured shape;
  returns `null` on a thrown error; a degraded empty-candidate result is returned non-null;
  `imageRefs` is dropped without error.
- **`diagnose_symptom` tool (unit):** result → `{ toConfirm, safetyFlags, internalScope }`, no
  `prediction_id`; `null` → `{ available: false }`.
- **No-regression (unit):** `create_order` is byte-for-byte unchanged in behavior — its existing
  prediction/estimate tests still pass; assert it still runs the fire-and-forget path on a symptom.
- **Intake behavior (eval, [→EVAL], `apps/agent/src/scripts/fixo-eval.ts` pattern):** given a repair
  symptom, the agent calls `diagnose_symptom` BEFORE the OLP/parts lookups and before
  `create_order`; asks a `toConfirm` question; surfaces a safety flag when present; and **never
  emits `candidate_systems` / `likely_root_cause` strings in assistant text** (hard leak gate). Also
  assert it is NOT called for routine maintenance (oil change).
- **UI (manual/confirm):** `diagnose_symptom` renders nothing in the customer chat
  (`hideGenericToolFallback` + non-whitelisted tool) — confirm no diagnosis pill leaks.

## Rollout

- N=1 on the dogfood mobile-mechanic shop. No flag needed — additive and best-effort; if the brain
  is down, intake degrades to today's behavior.
- Watch in the eval: does the agent reliably call `diagnose_symptom` (the prompt-conflict risk)
  without over-calling (cost/latency)? The "precondition of the one-turn pipeline, repair/diagnostic
  only" rule bounds it.
