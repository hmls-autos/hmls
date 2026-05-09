# TODOS

Tracked work deferred from PRs. Each entry includes design context so a future implementer can pick
it up cold.

---

## Bug B — PDF report endpoint always returns 400

**What:** `GET /sessions/:id/report` requires `fixoSessions.result` jsonb populated. No code writes
to it. Result: clicking "Report" in fixo-web always returns 400 "Session has no result yet".

**Why:** Closes the diagnostic dogfood loop. Mechanic-side users want a takeaway artifact from each
session.

**Pros:** Working PDF report unlocks the full UX. Validates the agent's diagnosis quality in a
structured form. Distinguishes "session in progress" from "session complete".

**Cons:** Larger than the original 15-min sketch. Needs design work on session-boundary semantics +
structured-output schema + UI.

**Context:**

- Original Plan A (D2 in 2026-04-26 plan-eng-review) said "on streamText.onFinish, write summary to
  fixoSessions.result." Codex correctly flagged this as hand-wavy:
  - `apps/gateway/src/routes/fixo/reports.ts:65-95` reads structured JSON
    `{summary, overallSeverity, issues[], obdCodes[]}`. Agent only streams freeform text.
  - Marking `status='complete'` on every `onFinish` breaks multi-turn — the first clarifying
    question would complete the session, follow-ups would overwrite the result.
- The right fix needs:
  1. Explicit user "I'm done" trigger (button or "finish session" intent), not
     implicit-on-stream-end.
  2. A separate structured-output LLM call (`generateObject` with a Zod schema) on demand, distinct
     from the conversational stream.
  3. Schema:
     `summary: string, overallSeverity: 'critical'|'high'|'medium'|'low', issues: Array<{title, severity, description, recommendedAction, estimatedCost?}>, obdCodes: Array<{code, meaning, severity}>`.
  4. Session-completion semantics: `fixoSessions.status='complete' + completedAt` only set when user
     finalizes. Subsequent activity reopens.
- Until this lands, Plan B (current PR) hides the "Report" button when `fixoSessions.result` is null
  to avoid the user-facing 400.

**Depends on / blocked by:** None. Standalone follow-up PR.

**Rejected alternatives:**

- (A) Bundle into Plan B: rejected as PR-doubling work and deserving its own design conversation.
- (C) Quick-and-dirty: dump full chat transcript into `fixoSessions.result`. Rejected — produces an
  unusable PDF and builds on a bad foundation that would need to be ripped out.

---

## Credit-deduction race (codex finding #4 from 2026-04-26 plan-eng-review)

**What:** `apps/gateway/src/middleware/fixo/credits.ts:42` `processCredits` is check-then-deduct
without a lock or idempotency mechanism. Two concurrent `/sessions/:id/input` requests on the same
`stripeCustomerId` can both pass the balance check before either calls `deductCredits`, causing
overdraft.

**Why:** Real bug. Exploitable: a user with `balance=5` and `cost=5/upload` who fires two concurrent
uploads ends with `balance=-5` and gets a free upload. Low blast radius at beta volume but
eventually exploitable.

**Pros:** Closes a real billing-correctness hole. Sets up the credit subsystem for higher
concurrency.

**Cons:** Stripe `customers.createBalanceTransaction` doesn't have a native
"decrement-if-sufficient" primitive — fix requires a workaround.

**Context:**

- Repro: two concurrent `POST /sessions/:id/input` with `type=photo`, balance just under
  `2 × required`, both succeed, customer goes negative.
- Fix paths (in increasing complexity):
  1. **DB-cached balance with row lock**: maintain a local `customer_credit_balance` table mirroring
     Stripe.
     `UPDATE ... SET balance = balance - $cost WHERE stripe_customer_id = $id AND balance >= $cost RETURNING balance`
     is atomic. Reconcile with Stripe nightly.
  2. **Stripe idempotency_key**: derive `idempotency_key = hash(customerId, sessionId, mediaId)`.
     Prevents same upload from double-charging on retry but doesn't prevent two different uploads
     from both passing the read-balance check.
  3. **Optimistic with retry**: read balance, attempt deduct, if Stripe reports insufficient
     (retry-once-after-fresh-read).
- Recommended path: (1) for correctness, augmented with (2) for retry-safety. Hold off on (3).

**Depends on / blocked by:** None. Independent of Bug B.

---

## Verify audio/webm as `FileUIPart` (codex finding #8 from 2026-04-26 plan-eng-review)

**What:** Plan B keeps the `analyzeAudioNoise` tool + client-side spectrogram path for audio. We
chose to defer the experiment of "does Gemini 3 Flash via `@ai-sdk/google` accept `audio/webm` as a
`FileUIPart` directly?". If it does, the spectrogram path can be deleted (~70 lines of WebAudio +
the `analyzeAudioNoise` tool ~100 lines).

**Why:** Possible 170-line deletion + cleaner architecture (single multimodal path for all media
types).

**Pros:** Removes a custom client-side audio-processing path. Simplifies the agent's tool surface to
`lookupObdCode + extractVideoFrames + ask_user_question + labor/parts/estimate`. Aligns photo and
audio paths.

**Cons:** Bounded but real experiment. Need a baseline.

**Context:**

- Hypothesis: AI SDK v6's `FileUIPart` with `mediaType: 'audio/webm'` (or `audio/mp3`) routes
  through `convertToModelMessages` → `@ai-sdk/google` → Gemini 3 multimodal input. Gemini 1.5+
  supports audio input for ~9 hours total per request. Gemini 3 Flash Preview should support the
  same.
- Experiment design:
  1. Curate 3-5 vehicle audio samples with known-correct diagnoses (engine knock, belt squeal, brake
     grinding, etc.).
  2. Run each via current spectrogram + `analyzeAudioNoise` path; record diagnosis.
  3. Run each via `FileUIPart` audio path (same agent minus the tool); record diagnosis.
  4. Score: which path identified the issue more accurately? Which gave more useful detail?
- If FileUIPart audio is at parity or better: delete `analyzeAudioNoise` + spectrogram client code.
- If worse: keep spectrogram path indefinitely; document the call.

**Depends on / blocked by:** Plan B merged (the codepaths are stable).

---

## Credit System Follow-ups (added by 0023 rebuild)

### F6 — Server-side `durationSeconds` validation + media size cap (P2)

**What:** `apps/gateway/src/routes/fixo/input.ts:39` reads client-supplied `durationSeconds` and
feeds it to `chargeForInput` for audio/video billing. Attacker can claim 1s for a 90s clip and pay
the minimum block. Storage path also has no server-side base64 size cap → memory abuse vector.

**Why:** Plugs a credit-cost bypass + storage abuse. Low blast radius (Fixo small userbase) but
landmines as we scale.

**Fix sketch:**

- Run ffprobe on the uploaded media to derive true duration server-side, OR cap `durationSeconds` at
  e.g. 600s (rejecting longer claims).
- Cap base64 body length (e.g. 50 MB) before decode.
- Both go in `apps/gateway/src/routes/fixo/input.ts` before the `chargeForInput` call.

### F7 — `/task` session ownership check (P3, pre-existing)

**What:** `apps/gateway/src/routes/fixo/chat.ts:34` accepts any integer `sessionId` and the agent
injects that session's `summary` + `diagnostic_state` into the system prompt. Cross-tenant data leak
via guessable IDs.

**Why:** This bug exists on main, not introduced by the credit rebuild. Worth fixing in its own PR.

**Fix sketch:**

```ts
const [session] = await db.select({ userId: schema.fixoSessions.userId })
  .from(schema.fixoSessions)
  .where(eq(schema.fixoSessions.id, parsedSessionId))
  .limit(1);
if (!session || (session.userId !== auth.userId && session.customerId !== auth.customerId)) {
  return c.json({ error: "Session not found" }, 404);
}
```

Add this between message validation and the `chargeForInput` call.

### Stripe ↔ ledger reconciliation (P3, ops-quality)

**What:** Cron job that detects drift between Stripe-collected money and ledger-granted credits.

**Why:** If a webhook drops, or someone tampers with the DB directly, we want to know. Audit
hygiene.

**Fix sketch (run nightly):**

```sql
-- Subscription grants this month
SELECT count(*), sum(delta) FROM credit_ledger
WHERE reason = 'subscription_grant' AND created_at >= date_trunc('month', now());

-- Top-up purchases this month
SELECT count(*), sum(delta) FROM credit_ledger
WHERE reason = 'topup_purchase' AND created_at >= date_trunc('month', now());
```

Compare against `stripe.invoices.list({status:'paid'})` and
`stripe.checkout.sessions.list({mode:'payment'})` totals. Alert (log + Slack/email) on >1% drift.

### `charge.refunded` Stripe webhook handler (P3, completeness)

**What:** Auto-call `refundCredits` when Stripe issues a refund (via Dashboard or Stripe API).
Currently refunds are manual.

**Why:** A user disputing on Stripe side gets their money back but keeps their credits — we should
sync.

**Fix sketch:** Subscribe to `charge.refunded`, look up the original PaymentIntent metadata, find
the credits granted, call `refundCredits({...originalLedgerRow, reason: 'stripe_refund'})`.

### Custom bonus-credits coupon system (P3, growth feature)

**What:** Stripe coupons only do $/% discounts. If we want codes that grant bonus credits without
affecting price (e.g., influencer codes, referral bonuses), build our own.

**Fix sketch:**

- New table
  `promo_codes (code text PK, kind text, value int, max_uses int, used int, expires_at timestamptz)`
- New endpoint `POST /billing/redeem` validates + rate-limits + calls
  `grantTopup({userId, amount: value, stripeEvent: 'promo:CODE:userId'})` for idempotency
- Frontend "Have a code?" input on settings/upgrade modal

### Migrate to Stripe Entitlements (P3, when adding 2nd paid tier)

**What:** When Pro launches (or earlier if we add feature flags), migrate from
`customer.subscription.*` events to `entitlements.active_entitlement_summary.updated`.

**Why:** Stripe is SoT, one event covers all subscription lifecycle (created/updated/deleted/trial/
dunning). Simplifies our code. **Overkill for one paid tier** — only worth it once we have ≥2.

**Fix sketch:**

- Stripe Dashboard: create features `fixo_plus_access`, `fixo_pro_access`, attach to respective
  Products.
- Webhook: replace 3 `customer.subscription.*` handlers with 1
  `entitlements.active_entitlement_summary.updated` handler.
- Keep `user_profiles.tier` as cache (refreshed by webhook).
- See `apps/agent/src/fixo/lib/stripe.ts` `tierFromPriceId` — can be replaced by entitlement
  lookup_key mapping.

### Async webhook processing (P3, scale)

**What:** Stripe recommends returning 2xx immediately and processing events on a queue. We do DB
work synchronously in the webhook request handler.

**Why:** For Fixo's current scale this is fine (<100ms per event). But Plus monthly renewal spike
could overwhelm the connection pool when N users all hit `invoice.payment_succeeded` simultaneously.

**Fix sketch:** Webhook handler INSERTs into a `stripe_events` table and returns 2xx; a worker (deno
cron, pg_cron, or external queue) consumes and runs grant logic. Keep idempotency on `event.id`
either way.

### `invoice.payment_failed` user notification (P3, dunning UX)

**What:** Currently we log `invoice.payment_failed` but don't notify the user. Stripe's smart
retries handle the technical retry, but the user has no idea their card failed until subscription
finally cancels.

**Fix sketch:** Wire mailer (already in @hmls/agent for order notifications) to send "card failed"
email on first `invoice.payment_failed` per subscription. Reset the suppression flag on
`invoice.payment_succeeded`.

### Stripe SDK upgrade (P3, hygiene)

**What:** `deno.json` pins `stripe@^20.4.1`. Latest is `22.x`. Latest Stripe API version is
`2026-04-22.dahlia` but our SDK only types up to `2026-02-25.clover`.

**Fix:** Bump SDK in `deno.json`, update `STRIPE_API_VERSION` in
`apps/agent/src/fixo/lib/stripe.ts`, also update Stripe Dashboard webhook endpoint API version. Test
webhook payload parsing after upgrade.

### Restricted API Key (RAK) migration (P3, security hygiene)

**What:** Deno Deploy uses `STRIPE_SECRET_KEY` (`sk_...`). Stripe best practices recommend
Restricted API Keys (`rk_...`) with minimal scope.

**Fix:** Stripe Dashboard → Developers → Create restricted key with: Customers (RW), Checkout
Sessions (RW), Billing Portal Sessions (RW), Subscriptions (R), Invoices (R), Webhook Events (R).
Replace `STRIPE_SECRET_KEY` env var. SDK accepts both transparently.
