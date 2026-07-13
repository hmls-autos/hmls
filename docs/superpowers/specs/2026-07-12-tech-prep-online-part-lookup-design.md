# Tech Prep Online Part Lookup Design

## Summary

Add a user-triggered **Look up part numbers** action to the internal Tech prep card. The action uses
Gemini with grounded Google Search to find up to three sourced OEM or reputable aftermarket part
numbers for every detected engine variant. It saves validated results directly into the order's JSON
items so they survive page refreshes without repeating the search.

This design extends the saved-reference work in
`2026-07-12-tech-prep-reference-part-numbers-design.md`. It replaces automatic estimate-time capture
as the primary workflow because the current RockAuto adapter returns no results for common vehicle
and service combinations.

## Goals

- Let an authenticated shop user explicitly request part-number research from Tech prep.
- Return up to three mixed OEM and reputable aftermarket candidates per detected engine variant.
- Ground every displayed candidate in an identifiable web source.
- Save results directly and durably without relying on the conversational agent to echo tool output.
- Preserve order price, lifecycle status, status history, and estimate revision.
- Reuse the existing Google API configuration without adding a search-provider secret.
- Make token and fitment limitations visible to staff.

## Non-goals

- Guaranteeing fitment without VIN, engine, trim, emissions package, or production-date data.
- Automatically purchasing parts or linking a result to an order cart.
- Showing part-number research to customers.
- Running online research during page load or refresh.
- Replacing a licensed OEM/aftermarket catalog if the business later acquires one.
- Backfilling all historical orders automatically.

## User Experience

### Empty State

When a Tech prep card has no saved online results, its header shows **Look up part numbers**. The
button is available only to authenticated admin/staff users on the internal order page.

Selecting it:

1. Disables the button and shows a lookup-in-progress state.
2. Sends one authenticated request for the current order.
3. Searches every labor item that carries Tech prep metadata and has a usable service name.
4. Revalidates the order after the server saves results.
5. Shows a success or partial-result toast.

### Saved State

Saved results appear under **Reference part numbers**, grouped in this order:

1. Service.
2. Detected engine variant.
3. Up to three candidates for that engine.

Each candidate displays:

- OEM or Aftermarket.
- Brand/manufacturer.
- Part number in copy-friendly monospace text.
- A short fitment note.
- A source link.

The section displays **Best-effort — verify VIN, engine, emissions, and production date before
purchase**. An engine variant that could not produce sourced candidates may display its own
no-result warning instead of invented numbers.

When saved results exist, the action label becomes **Refresh part numbers**. Refresh replaces the
online result set only after a new validated search succeeds. A failed refresh leaves existing data
untouched.

## Architecture

### Request Path

Add an authenticated admin endpoint:

```text
POST /api/admin/orders/:id/reference-parts/lookup
```

The existing web API client calls this endpoint directly. The button does not send a chat message or
invoke the general staff-agent loop.

The endpoint:

1. Validates the order ID, authenticated admin, and active shop scope.
2. Loads the scoped order and selects eligible Tech prep labor items.
3. Rejects the request when year, make, or model is unavailable.
4. Applies a 60-second process-level per-order cooldown and prevents overlapping lookups.
5. Calls the focused online part-research service.
6. Validates and normalizes all model output.
7. Atomically updates only matching items' internal reference metadata.
8. Returns the refreshed order plus lookup summary.

### Online Research Service

Create an isolated service that uses the existing `GOOGLE_API_KEY`, `@ai-sdk/google`, and the
provider's `googleSearch` grounding tool. Use the project's configured Gemini Flash-family model,
with a dedicated environment override for future model changes if needed.

The request contains only:

- Year, make, and model.
- The eligible service names and stable order-item IDs.
- Instructions to detect engine variants and return no more than three candidates per variant.
- Source quality, output schema, and anti-hallucination rules.

It must not include customer identity, contact information, address, notes, or other order data.

The system instructions treat web content as untrusted data and forbid following instructions found
in pages. They prioritize manufacturer catalogs, OEM dealer catalogs, part-manufacturer fitment
catalogs, and established retailers. Forums, snippets without product evidence, marketplace sellers,
and AI-generated aggregation pages are insufficient as the sole source.

The model returns structured JSON that is parsed with Zod. Grounding metadata and returned URLs are
used to construct the allowed source set; model-provided links not present in the grounded source
set are rejected.

### Validation and Ranking

For each service and engine variant:

- Keep at most three candidates.
- Require non-empty brand, part number, type, fitment note, and HTTPS source URL.
- Require type to be `oem` or `aftermarket`.
- Require the source URL to appear in Gemini's grounding sources.
- De-duplicate normalized brand and part number values.
- Prefer candidates supported by manufacturer or fitment-catalog sources.
- Preserve the model's evidence-based ordering after invalid candidates are removed.
- Never fill missing values from model intuition or another candidate.

Partial results are valid. If every candidate is invalid or unsourced, the endpoint returns a
no-results response and does not overwrite saved data.

## Data Model

Extend the internal `PartReference` shape with optional online-research fields:

```ts
interface PartReference {
  partName: string;
  brand: string;
  partNumber: string;
  source: "rockauto" | "google_search";
  oemPartNumber?: string;
  engineVariant?: string;
  partType?: "oem" | "aftermarket";
  fitmentNote?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  searchedAt?: string;
}
```

Continue storing `referenceParts` on each `OrderItem` in the order's existing JSON `items` column.
No SQL migration is required for result storage.

The endpoint performs a metadata-only, tenant-scoped JSON item update. It does not call
`patchItems`, because that harness recalculates prices, increments the estimate revision, and may
pull an estimated order back to draft. The update changes only `items.referenceParts` and
`updatedAt`, using an optimistic guard so concurrent item edits fail safely instead of being
overwritten.

No customer-visible order event is emitted. Existing `items_edited` events are customer-visible and
would incorrectly suggest that the estimate changed. Server logs record the actor, order ID, result
counts, duration, model, and token usage without logging prompts or customer data.

## Concurrency and Cost Controls

- The UI prevents duplicate clicks while one request is active.
- The endpoint allows only one in-flight lookup per order within a process.
- A 60-second process-level cooldown rejects accidental repeat requests with a clear retry time. It
  is a best-effort duplicate guard in a multi-instance deployment; the UI's in-flight lock remains
  the primary duplicate-click prevention. A refresh remains available after the cooldown.
- One click uses one grounded Gemini request containing all eligible services for that order.
- A page refresh reads saved JSON only and consumes no model or search tokens.
- Failure, timeout, or invalid output never clears previously saved results.

## Error Handling

- Missing vehicle year/make/model: return a validation error; no model call.
- No eligible Tech prep labor items: return a validation error; no model call.
- Search timeout/provider failure: retain saved results and return a retryable error.
- No grounded candidates: retain saved results and return a no-results response.
- Some services or engines succeed: save valid partial results and report which groups failed.
- Optimistic write conflict: discard the generated write, tell the user to refresh, and preserve the
  concurrently edited order.
- Unauthorized or cross-shop order: return the existing not-found/forbidden behavior without
  revealing order existence.

## Security and Privacy

- Reuse existing admin authentication and tenant scoping.
- Send no customer PII to Gemini or Google Search.
- Treat all web content as untrusted.
- Enforce structured schemas and bounded string lengths.
- Accept only HTTPS sources returned by grounding metadata.
- Render source URLs as safe external links with appropriate `rel` attributes.
- Never render model-supplied HTML.

## Testing

### Agent/Service Tests

- Prompt input contains only vehicle and service data.
- Engine variants and candidates are normalized and grouped correctly.
- Results are capped at three per engine.
- OEM/aftermarket values are both accepted.
- Duplicate, malformed, overlong, non-HTTPS, and ungrounded candidates are rejected.
- Partial and no-result behavior preserves existing references.

### Gateway/Persistence Tests

- Authentication, tenant scoping, invalid IDs, missing vehicle data, and cooldown behavior.
- Metadata-only update preserves prices, subtotal, status, status history, and revision number.
- Optimistic conflicts do not overwrite concurrent edits.
- Failed and empty searches do not erase saved results.

### Web Tests

- Empty, loading, success, partial, cooldown, and failure states.
- Button label changes from lookup to refresh after saved online results exist.
- Results remain after SWR revalidation and a full page reload.
- Grouping is service then engine, with at most three displayed candidates per engine.
- Source links and verification warning render safely at desktop and narrow widths.

## Acceptance Criteria

- An admin can select **Look up part numbers** from Tech prep.
- One click performs a grounded online search using the existing Google configuration.
- Each detected engine variant receives up to three sourced OEM/aftermarket candidates per service.
- Valid results are saved directly on the order and survive refresh.
- Existing results survive provider, validation, and write failures.
- Lookup metadata never changes customer pricing, status, history, or revision.
- Customer-facing surfaces never expose the internal results.
- Automated checks pass and the authenticated local HMLS order page is visually verified.
