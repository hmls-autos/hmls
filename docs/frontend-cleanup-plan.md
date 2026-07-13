# Frontend cleanup plan (shadcn adoption audit)

> **Status (2026-07-13):** PR `spinsirr/frontend-cleanup-deadcode` shipped the **safe, zero-visual-change slice**:
> all dead-code deletions (chat Wave 4 + `code-block.tsx` + `shiki` dep, ~800 net lines), the `MATH_RE`
> currency-triggers-KaTeX bugfix, and the `renderableMessages`/`mapNextUserAnswers` dedup across the 3 chat
> surfaces. **Deferred (need a running app + eyeballs, not shipped):** shadcn primitive swaps (Wave 1 — native
> `<select>`→`Select` etc. change rendering), Wave 2 (AlertDialog behavior change + new installs), Wave 3
> non-dead-code dedup, Wave 5 token migration (visual diffs everywhere). Do those interactively with screenshots.

_Audit date: 2026-07-12. 6 parallel readers over all 126 tsx files in apps/hmls-web, findings
adversarially verified (96 raw → 85 kept, 11 rejected). Full JSON: workflow run `wf_c206321b-ba0`._

## Verdict

The stack is already Vercel-native — shadcn/ui (new-york, zinc, Tailwind v4, unified `radix-ui`
package), sonner wired in root layout, AI Elements for chat. The problem is not missing libraries;
it is **inconsistent adoption**: 15 primitives installed but raw `<select>`/`<button>`/`<input>`
still hand-rolled beside them, two parallel design-token systems, four copies of the same
promise-dialog plumbing, and ~300 lines of dead exports.

## Install once (all official registry, no new runtime deps)

```bash
cd apps/hmls-web && bunx shadcn@latest add \
  alert alert-dialog avatar breadcrumb checkbox command empty \
  kbd popover progress sheet spinner toggle-group
```

## Wave 1 — mechanical swaps to already-installed primitives (all S)

Native `<select>` → `Select` (installed, used elsewhere — worst inconsistency):

- [ ] components/order/ItemEditor.tsx:98 (category picker)
- [ ] components/order/MarkPaidDialog.tsx:79 (payment method)
- [ ] components/ui/AuthorizeDialog.tsx:110 (authorization channel)
- [ ] components/admin/mechanics/EditHoursDialog.tsx:115 (+ raw time inputs → `Input type=time`)
- [ ] components/admin/mechanics/ReassignBookingDialog.tsx:76 (mechanic picker)
- [ ] components/mechanic/CollectPaymentDialog.tsx:133 (payment method)
- [ ] app/(mechanic)/mechanic/availability/page.tsx:133 (see Wave 3 WeeklyHoursEditor — fix there)
- ~~SlotPickerCard native selects~~ — KEEP: deliberate mobile-friendly choice (customer chat)

Raw buttons/inputs/labels → `Button`/`Input`/`Label`:

- [ ] app/(auth)/login/page.tsx:166 — whole login form (6 raw buttons, 2 raw inputs); layout ≈ shadcn `login-01` block
- [ ] app/(portal)/portal/orders/[id]/page.tsx:383,580,590,605,627
- [ ] app/(portal)/portal/orders/page.tsx:103,113 (drop hardcoded red palette)
- [ ] app/(portal)/portal/profile/page.tsx:96,136,149,185 (local Field component)
- [ ] app/estimate/[id]/page.tsx:334,344,359
- [ ] app/error.tsx:37 + app/not-found.tsx:25-38 (`Button asChild` for Links)
- [ ] components/Navbar.tsx:111,124,137 (Sign Out / Sign In / CTA)
- [ ] components/chat/tool-cards/ContactIntakeCard.tsx:85-139 (keep buildContactMessage contract — unit-tested)
- [ ] components/chat/tool-cards/AskUserQuestionCard.tsx:43 (`Button variant=outline h-auto`)
- [ ] components/admin/orders/SetTimeDialog.tsx:110 (3 label+input pairs)
- [ ] app/(mechanic)/mechanic/time-off/page.tsx:81 (raw date input)

Other installed-primitive swaps:

- [ ] components/ThemeToggle.tsx:108 — hand-rolled dropdown (manual outside-click/Esc) → `DropdownMenu`
- [ ] components/order/OrderChatPanel.tsx:68 — hand-rolled collapsible → `Collapsible` (forceMount)
- [ ] components/order/TechPrepCard.tsx:78 — tool chips → `Badge variant=outline`
- [ ] components/EstimateCard.tsx:56 — amber status pill → `Badge`
- [ ] components/chat/tool-cards/index.tsx:54 — skill chip → `Badge variant=secondary`
- [ ] components/ui/StatusBadge.tsx:20 — render through `Badge`; fallback → muted tokens
- [ ] components/sections/ServiceArea.tsx:12,67 — pulse divs → `Skeleton`
- [ ] app/(marketing)/areas/page.tsx:30 — eyebrow pill → `Badge` custom variant (shared)

## Wave 2 — swaps needing newly-installed components (S unless noted)

Destructive confirmations → `AlertDialog` (correct semantics: no outside-click dismiss):

- [ ] components/ui/ConfirmDialog.tsx:82 — swap Dialog body for AlertDialog, KEEP promise-based askConfirm API (callers: marketing chat, admin chat, estimate, OrderChatPanel)
- [ ] app/(admin)/admin/customers/page.tsx:391 — inline confirmDelete state → askConfirm

Callouts → `Alert` (+ AlertTitle/AlertDescription):

- [ ] components/order/DraftBanner.tsx:29 (Card abused as warning callout)
- [ ] app/(admin)/admin/chat/page.tsx:250 (error banner)
- [ ] app/(marketing)/chat/page.tsx:293 (light-only red palette — currently unreadable in dark mode)
- [ ] app/(portal)/portal/orders/[id]/page.tsx:406,552 (tentative-booking + cancellation-reason)

Loading/empty unification:

- [ ] `Spinner`: replace components/ui/Spinner.tsx (3 portal pages), border-spin divs in login page + estimate page, pulse text in marketing chat:234,403. Keep ai-elements Loader (distinct chat affordance).
- [ ] `Empty`: replace components/ui/EmptyState.tsx + 4 bespoke empty states (customers:616,659 / orders:751 / mechanics:171)

One-offs:

- [ ] components/admin/mechanics/MechanicCard.tsx:54 + app/(portal)/portal/profile/page.tsx:161 → `Avatar`/`AvatarFallback`
- [ ] components/admin/mechanics/UtilizationBar.tsx:28 + app/(admin)/admin/page.tsx:150 (FunnelChart bars) → `Progress`
- [ ] app/(admin)/admin/orders/[id]/page.tsx:180 + app/(portal)/portal/orders/[id]/page.tsx:371 → `Breadcrumb`
- [ ] components/admin/mechanics/AddTimeOffDialog.tsx:110 → `Checkbox` + Label
- [ ] components/order/CustomerEditor.tsx:74 → `ToggleGroup type=single` (preferred contact)
- [ ] app/(admin)/admin/orders/page.tsx:571 → `Kbd` (⌘↵ badge)
- [ ] app/(admin)/admin/customers/page.tsx:599 → `InputGroup` (search icon input)
- [ ] app/(admin)/admin/orders/page.tsx:161 CustomerPicker → `Command` + `Popover` async-combobox (M; keeps sessionStorage draft/create-mode/hydration logic; gains arrow-key nav + listbox a11y)
- [ ] components/MobileNav.tsx:74 → `Sheet` (M; gains focus trap + scroll lock + overlay it currently lacks)

## Wave 3 — consolidation (dedup, no new components)

- [ ] Promise-dialog singleton ×4 → one generic `createAskDialog<T>` helper: ConfirmDialog:25-79, ReasonDialog:24-82, AuthorizeDialog:29-96, CollectPaymentDialog:32 (~40 lines saved per copy; combines with the AlertDialog swap)
- [ ] WeeklyHoursEditor: EditHoursDialog.tsx:15 ≈ mechanic/availability/page.tsx (same DAY_LABELS/normalize/slot editor) → one shared component
- [ ] MechanicProfileFields: EditProfileForm.tsx:44 ≈ AddMechanicDialog (same fields+validation+scaffolding)
- [ ] KpiTile duplicated verbatim: mechanics/page.tsx:21 ≡ mechanics/[id]/page.tsx:146
- [ ] OrderStatusBadge defined twice (orders/page.tsx:67, orders/[id]/page.tsx:57 — latter carries dead status/config props) → one shared StatusConfig→Badge wrapper
- [ ] FilterChip ×3 (orders pills :676/:705, mechanics FilterChip:34) → one shared FilterChip
- [ ] useOrderDecision hook: approve/decline flow duplicated in portal orders:132, orders/[id]:302, estimate page
- [ ] SectionLabel duplicated: admin/page.tsx ≡ portal/orders/[id]/page.tsx:234 → shared
- [ ] app/estimate/[id]/page.tsx:41,45 local formatCents/formatDate → import @/lib/format
- [ ] components/sections/About.tsx:10 inline IntersectionObserver → wrap in RevealOnScroll
- [ ] Delete components/ui/Animations.tsx entirely: FadeIn = rename-wrapper of RevealOnScroll (7 marketing pages import it); ScaleIn/StaggerContainer dead
- [ ] Order detail `<Section>` wrapper: 5 section components repeat the same Card shell ×7
- [ ] components/Navbar.tsx:80 role-visibility predicates → lib/nav `visibleNavLinks()` shared with MobileNav
- [ ] areas/[city]/page.tsx:101 CTA pair byte-identical across city pages → shared component
- [ ] portal clickable-row card recipe (orders:41 ≈ portal/page.tsx:96) → one OrderRow

## Wave 4 — dead code (delete, all grep-verified)

- [ ] components/ai-elements/message.tsx:139-342,91-137,383-399 — MessageBranch family + MessageActions + MessageToolbar (~250 lines)
- [ ] components/ai-elements/conversation.tsx:42-75,108-173 — ConversationEmptyState, ConversationDownload, messagesToMarkdown, getMessageText
- [ ] components/ai-elements/prompt-input.tsx:132-139,168-170 — PromptInputTools, PromptInputBodyProps (dangling type)
- [ ] components/chat/tool-cards/index.tsx:134-142 — re-export block (only renderToolCard is consumed)
- [ ] components/ui/Animations.tsx — ScaleIn, StaggerContainer (whole file goes in Wave 3)
- [ ] components/EstimateCard.tsx:10,37 — legacy estimateId field + `?? fallback` (estimates table dropped in Layer 3)

## Wave 5 — token unification (the real L; separate PR)

Two design-token systems coexist: legacy (`text-text`, `text-text-secondary`, `bg-surface`,
`bg-surface-alt`, `red-primary`, `red-light` — globals.css:42-93) vs shadcn
(`foreground`/`muted-foreground`/`card`/`muted`/`primary`). Marketing + portal + estimate surfaces
are on legacy; admin is on shadcn; some files mix both.

- [ ] Migrate marketing pages (areas/services/contact/privacy/terms + sections/*) legacy → shadcn tokens
- [ ] Migrate portal/auth/estimate pages (dual-token mix verified in portal/orders/page.tsx:52)
- [ ] Then delete or alias the legacy token block in globals.css
- [ ] Scattered raw palette fixes: admin urgency `bg-red-500/10 text-red-600` (admin/page.tsx:54, DashboardLayout.tsx:121) → theme token; `bg-primary text-white` → `text-primary-foreground` (orders:683+); form errors `text-red-600` → `text-destructive` (4 mechanics dialogs); Footer raw palette vs defined `--footer-*` tokens; RealMap #dc2626 hex + z-[400] → var + z-10
- [ ] Nested cards: ItemEditor.tsx:87 + CustomerEditor.tsx:38 drop inner card wrapper

## Explicitly NOT doing (adversarially rejected — do not re-litigate blindly)

- SlotPickerCard native `<select>` — deliberate mobile-friendly choice on the customer chat surface
- DashboardLayout hand-rolled sidebar → shadcn Sidebar block — 40 working lines, mobile split is deliberate architecture; the block would fight MobileNav
- Dashboard sparkline → shadcn chart — would add recharts dependency for one 45-line self-contained SVG
- Marketing Hero/CTA buttons → Button — fully bespoke marketing styling (ring animation, group-hover), zero variant reuse
- EstimateCard → Card slots — banded receipt layout doesn't fit Card's slot model; token fix covered by Wave 5
- Portal order detail `<table>` → Table — already semantically correct; compact styling is deliberate
- `Field` component adoption — 1:1 markup rename, zero reduction (forms use one shared error line by design)
- ActivityTimeline ↔ portal StatusTimeline merge — different contracts; admin copy must not leak to customers

## Suggested execution order

1. Ship the current branch (order-detail layout + filter fixes) first.
2. Wave 4 (dead code) + Wave 1 — mechanical, low-risk, one PR.
3. Install command + Wave 2 — one PR (askConfirm/AlertDialog is the only behavioral change: outside-click no longer dismisses destructive confirms, which is the point).
4. Wave 3 — one or two PRs (promise-dialog helper first, it unlocks the dialog rewrites).
5. Wave 5 token migration — its own PR, visual-diff heavy, review with screenshots.

---

# Chat surfaces (separate assessment, 2026-07-12)

_3 chat surfaces: `app/(marketing)/chat/page.tsx` (customer, 413), `app/(admin)/admin/chat/page.tsx`
(staff, 310), `components/order/OrderChatPanel.tsx` (order Assistant tab, 259). All on AI SDK v6
`useAgentChat` + vendored `components/ai-elements/*` (1654 lines). Workflow `wf_928940b7-44a`; the
adversarial-verify pass hit a session limit, so proposals are self-reported + manually spot-checked
(delete-safety and the two bugs below confirmed by grep, ✓ marked)._

## Headline

The chat plumbing is **already good** — `useAgentChat` hook owns all the useChat/transport/headers/
persist wiring (no duplication there), the vendored ai-elements are a healthy fork **ahead** of
upstream (lazy KaTeX/mermaid, `resize="instant"` streaming fix, a 170-line prompt-input vs upstream's
1463), and the ChatMessage part-switch pipeline is sound. So this is **cleanup + dedup, not a
rewrite**. Realistic deletion ~650-900 lines and one dependency, zero customer-visible change.

## Two real bugs (fix regardless of refactor)

- [ ] ✓ **MATH_RE matches currency** — `lib/streamdown-plugins.ts:25` `/…|\$[^$\n]+\$|…/` fires on
  "labor $180 and parts $95" (the money-densest text this app has), lazy-downloading ~280KB KaTeX for
  nothing and possibly rendering the span between two prices as math. Tighten to `$$…$$`, `\(`, `\[`
  only. One line. (S)
- [ ] ✓ **customer reasoning filter is load-bearing** — if the ChatShell extraction below unifies the
  renderable predicate, the customer surface's `p.type !== "reasoning"` exclusion (chat/page.tsx
  ~200) MUST become an explicit `includeReasoning:false` option, or reasoning-only assistant messages
  render as empty bubbles in customer chat.

## Delete now (all grep-verified ✓, ~840 lines + 1 dep)

- [ ] ✓ **code-block.tsx (346 lines) + `shiki` dep** — imported ONLY by `tool.tsx`, only to
  pretty-print JSON in the collapsed staff-only generic-tool debug panel (customer chat passes
  `hideGenericToolFallback`). Chat-text code blocks go through streamdown's own `@streamdown/code`, not
  this. Replace the 3 CodeBlock call sites in tool.tsx with `<pre className="overflow-x-auto p-4
  font-mono text-xs whitespace-pre-wrap">`, delete code-block.tsx, drop `"shiki"` from package.json:40
  (imported nowhere else). Cost: staff lose JSON syntax coloring in a debug drawer only unrecognized
  tools ever open. (S)
- [ ] ✓ **message.tsx dead exports (~250 lines)** — MessageBranch suite (139-341), MessageActions/
  MessageAction (91-137), MessageToolbar (383-399): zero external importers. Only Message/
  MessageAvatar/MessageContent/MessageResponse are used. Drops transitive Tooltip/ButtonGroup/Chevron
  imports. (S) _[same finding as main-audit Wave 4]_
- [ ] ✓ **conversation.tsx dead exports** — ConversationDownload + messagesToMarkdown + getMessageText
  (108-173): zero importers. Keep Conversation/ConversationContent/ConversationEmptyState/
  ConversationScrollButton. (S) _[Wave 4]_
- [ ] **prompt-input.tsx dead exports** — PromptInputTools + dangling PromptInputBodyProps type. (S) _[Wave 4]_

## Dedup (cross-surface, no new components)

- [ ] ✓ **renderableMessages / mapNextUserAnswers** — exported once from ChatMessage.tsx:32,46;
  OrderChatPanel already imports them, but admin/chat (~122-155) and marketing/chat (~194-226) carry
  byte-identical inline copies. Import them; add `renderableMessages(msgs, {includeReasoning=true})`
  and pass `false` from customer (the bug above). ~-60 lines. (S) **Do this first — free win.**
- [ ] **ChatPromptInput component** — `input` state + handleSubmit + onSubmitOnEnter are triplicated
  byte-for-byte (customer 184-189/379-383, admin 115-120/292-296, order 129-134/224-228). Extract
  `{inputId,label,placeholder,isLoading,onSend,inputRef?,toolbarStart?}`; `toolbarStart` absorbs the
  one difference (customer/admin show the Enter hint, order puts its Clear button there). ~-45 net. (S)
- [ ] **ChatShell (ChatConversation body)** — the whole `<Conversation>`-inward block is triplicated:
  message loop, the byte-identical 12-line "Working on it…" loader bubble, error banner, scroll button.
  Extract `{chat, mode, hideReasoning?, hideGenericToolFallback?, emptyState, className, errorTone}`.
  ~-140 net; loader/error/message-loop bugs get one fix site instead of three. (M) **Honest warts:**
  customer's full-bleed absolute-overlay layout means the shell must be strictly Conversation-inward
  (cannot own header/input); the (marketing) vs (admin) route groups use different token systems so
  `errorTone` needs two hardcoded variants not a className; must preserve ChatMessage memoization
  (no fresh callback identities per render) or streaming perf regresses.
- [ ] **ToolHeader prop-union flatten** — tool.tsx:35-45 discriminated union forces ChatMessage:144-151
  to build two prop shapes. Change to `{title?,className?,state,toolName}`, always pass
  `getToolOrDynamicToolName(part)`. ~-15 lines, kills the one awkward seam. (S)

## Decide deliberately (not auto)

- [ ] ✓ **reasoning.tsx (224 lines) is dormant** — deepseek-v4-pro emits no reasoning_content and grep
  finds zero reasoning/sendReasoning config in apps/agent + apps/gateway, so the reasoning part never
  reaches the UI. **Recommend KEEP** — costs nothing at runtime (only mounts if a reasoning part
  exists), free insurance for a one-env-var `HMLS_AGENT_MODEL` swap to a reasoner. Delete only if you
  want the 224 lines gone now (also remove the reasoning branch in ChatMessage:124-132 + the
  `p.type==="reasoning"` clauses). NOTE: Shimmer is NOT collateral — LookupStatusCard uses it.

## Explicitly skip (verified not worth it)

- Re-syncing any vendored ai-element from upstream — our fork is ahead, not stale.
- All 39 unused upstream AI Elements (voice, coding-agent, canvas, plan/task, RAG, image, model-selector)
  — N/A for a text-only DeepSeek estimate/ops chat. Two future triggers: adopt `confirmation` if staff
  tool-approval ships (tool.tsx already renders the approval states); `image` only if backend goes multimodal.
- New `@shadcn/message|bubble|attachment|message-scroller` — verified thinner than our message.tsx
  (no markdown/streaming/bubble styling) and pulls a new `@shadcn/react` runtime dep. Lateral-at-best.
- Shared ChatWelcome component — static JSX, ~35 lines, YAGNI until a 4th chat surface appears.

## Suggested chat execution order

1. The two bugs + the four deletes + the helper dedup — one PR, ~900 lines gone, zero behavior change.
2. ChatPromptInput + ChatShell + ToolHeader flatten — one PR, smoke-test one Q&A round per surface
   (the nextUserAnswer lookup drives ask_user_question answered-state; a regression silently re-enables
   answered SlotPickers).
