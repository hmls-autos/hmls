---
title: Tavily and DeepSeek part-number research provider
date: 2026-07-13
status: approved
depends_on: 2026-07-12-tech-prep-browser-local-part-lookup-design.md
supersedes: Google/Gemini provider runtime in the dependent design
---

# Tavily and DeepSeek part-number research provider

## Problem and scope

The manual Tech prep part-number lookup currently uses Gemini twice: a Google-grounded research
pass followed by a structured extraction pass. HMLS otherwise uses DeepSeek as its primary agent
model. The lookup should instead use Tavily only for on-demand web retrieval and DeepSeek for all
part identification, engine-variant reasoning, and structured extraction.

This change affects only the manual **Look up part numbers** action introduced by the dependent
design. It does not change order creation, the HMLS agent's existing database-backed repair-job
search, Fixo, chat summarization, media handling, or any other Google/Gemini feature. The project
continues to require `GOOGLE_API_KEY` for those existing features. Removing Google from the entire
project is reserved for a future, separately approved design and pull request.

## Trigger and request boundary

Tavily is called only after a user authorized by the dependent feature explicitly clicks **Look up
part numbers** or **Refresh part numbers**. This provider change keeps that existing authorization
boundary; moving the action between admin and mechanic surfaces is a separate access-control
decision. Creating, loading, or refreshing an order does not call Tavily or DeepSeek. The existing
60-second in-process cooldown continues to prevent accidental duplicate lookups.

Each button click makes at most one Tavily Basic Search request, regardless of how many eligible
services the order contains. The bounded query contains only:

- vehicle year, make, and model; and
- all eligible Tech prep service IDs and names.

It contains no customer identity, phone, email, address, VIN, notes, order ID, price, or other
customer data. The stateless lookup endpoint remains isolated from the HMLS database and performs
no application-table reads or writes.

## Provider flow

### Tavily retrieval

Call `POST https://api.tavily.com/search` directly with bearer authentication from
`TAVILY_API_KEY`; do not add a Tavily SDK dependency. Use a deterministic combined query and the
following bounded behavior:

- `search_depth: "basic"`;
- `topic: "general"`;
- United States country boost;
- `include_answer: false` so Tavily does not become a second reasoning model;
- cleaned raw page content enabled with `include_raw_content: "text"`;
- `max_results: 10` to cover common one-to-three-service orders; and
- usage metadata enabled for credit observability.

The server converts returned results into provider-neutral evidence blocks. It accepts only HTTPS
URLs whose finite Tavily relevance score is at least `0.5`. Each block combines the title, relevant
snippet, and cleaned content, capped at 4,000 characters per result before it reaches DeepSeek.
Malformed and lower-scoring results are discarded. Result text and remote pages remain untrusted
data, never model instructions.

There is no automatic per-service search, follow-up Tavily Extract request, retry, advanced search,
or Google fallback. If the combined request lacks evidence for one service, that service returns no
verified match. A user may explicitly press **Refresh part numbers** later to perform another
single search.

### DeepSeek extraction

Send the bounded vehicle/services request and Tavily evidence blocks to DeepSeek through the
existing AI SDK provider. Default this isolated task to `deepseek-v4-flash`, with
`PART_LOOKUP_DEEPSEEK_MODEL` as the dedicated model override for controlled evaluation. DeepSeek
returns the existing strict structured shape:

- service ID;
- engine variant;
- brand;
- part number;
- OEM or aftermarket classification; and
- short fitment note.

DeepSeek does not create or select source URLs. The deterministic normalizer accepts a candidate
only when its service ID came from the request and its normalized part number appears literally in
a qualifying evidence block. It rejects duplicates, marketplace-only evidence, malformed values,
and candidates beyond the existing three-per-engine cap. Source title and URL come directly from
the matched Tavily evidence block.

## Provider-neutral browser data

Online records use a provider-neutral `web_search` source value instead of the current
`google_search` value. The UI continues to display the supporting page title and URL; it does not
need to know which retrieval vendor produced the evidence.

Browser-local persistence moves to cache schema v2 so records are validated against the new source
shape. Existing v1 Google-search cache entries are ignored after the upgrade rather than mixed with
Tavily results. The first successful Tavily lookup replaces them, and subsequent page refreshes
restore the v2 result as before. No result is shared across browsers, users, or devices.

## Configuration and ownership

`TAVILY_API_KEY` is injected from Infisical and never exposed to the browser. The committed source,
tests, logs, fixtures, and documentation contain no credential. A key pasted into chat or another
non-secret channel must be revoked before live verification.

This pull request removes `GOOGLE_API_KEY`, `@ai-sdk/google`, and Gemini model usage only from the
part-number research service. It does not remove the project's global Google configuration. Any
decision to eliminate Google across HMLS belongs to the platform's highest-level administrator and
requires a separate change.

## Errors and observability

- Apply a 20-second timeout to the single Tavily request.
- Missing or invalid Tavily configuration, authentication failure, quota exhaustion, rate limiting,
  timeout, and provider 5xx responses produce a sanitized lookup error.
- DeepSeek provider or structured-output failure produces a sanitized lookup error.
- No qualifying evidence returns `no_results` without invoking DeepSeek.
- Partial evidence returns only deterministically accepted references.
- Provider failure and `no_results` retain the browser's last successful result.
- Do not retry automatically and do not fall back to Google.
- Log provider name, duration, Tavily credits, result/evidence/source/reference counts, and DeepSeek
  token usage. Do not log credentials, full queries, raw page content, model prompts, customer data,
  or full model output.

## Testing and acceptance

Automated tests cover:

- one combined Tavily request for an input containing multiple services;
- the exact absence of customer and order data from the Tavily query;
- request parameters, bearer-header placement, and response timeout;
- Tavily-result conversion, HTTPS enforcement, relevance filtering, text bounding, and malformed
  response handling;
- skipping DeepSeek when no qualifying evidence exists;
- DeepSeek structured extraction and deterministic literal-part-number binding;
- rejection of unsupported, duplicate, marketplace-only, and over-cap candidates;
- sanitized handling of Tavily authentication, rate-limit, timeout, and provider failures;
- `web_search` UI grouping and cache-v2 validation;
- preservation of the last successful browser result after failures; and
- proof that the lookup route remains database-free and manually triggered.

Live verification runs through Infisical with the rotated `TAVILY_API_KEY` and existing
`DEEPSEEK_API_KEY`. A 2018 Toyota Camry serpentine-belt lookup must return only source-backed engine
variants and part numbers, open the cited HTTPS pages, persist after a browser refresh, consume one
Tavily search credit, and leave the order database unchanged.

Project verification includes Deno check, lint, formatting, focused agent/gateway/web tests, and the
relevant full suites. The provider change is opened as a stacked pull request based on the manual
part-number lookup branch; after that dependency merges, its base is retargeted to `main`.

## Out of scope

- Automatic search during order creation or page load.
- One Tavily request per service, automatic follow-up search, or scheduled refresh.
- Tavily Advanced Search, Tavily Extract, or Tavily-generated answers.
- Retail price, rating, inventory, delivery, or local-pickup comparison.
- Changing database-backed repair-job search or any application schema.
- Moving the lookup between admin and mechanic authorization surfaces.
- Removing Google/Gemini from Fixo or the rest of HMLS.
