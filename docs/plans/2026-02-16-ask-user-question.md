# Ask User Question Tool — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Add an `ask_user_question` tool so the HMLS agent can present structured, clickable
question cards in the chat UI.

**Architecture:** The agent calls an `ask_user_question` tool with question/option data. AG-UI
streams the tool call args to the frontend. The frontend intercepts the tool name, renders an
interactive card instead of a spinner, and sends the user's selection as the next message. No
protocol changes needed.

**Tech Stack:** Zod (tool schema), Zypher (agent tools), React 19 + Framer Motion (card UI), AG-UI
client (event interception)

---

### Task 1: Create the backend tool

**Files:**

- Create: `apps/api/src/tools/ask-user-question.ts`

**Step 1: Create the tool file**

```typescript
// apps/api/src/tools/ask-user-question.ts
import { z } from "zod";
import { toolResult } from "@hmls/shared/tool-result";

export const askUserQuestionTool = {
  name: "ask_user_question",
  description:
    "Present the customer with a structured question card with clickable options. Use this instead of asking open-ended questions when the answer is one of a known set of choices. Examples: selecting a service, confirming an action (yes/no), choosing between options. The customer will see buttons they can tap. Only ask ONE question at a time.",
  schema: z.object({
    question: z.string().describe("The question to ask the customer"),
    header: z.string().describe("Short label displayed above the question (2-4 words)"),
    options: z
      .array(
        z.object({
          label: z.string().describe("Button text for this option (1-5 words)"),
          description: z
            .string()
            .optional()
            .describe("Optional extra context shown below the label"),
        }),
      )
      .min(2)
      .max(6)
      .describe("The choices the customer can pick from"),
  }),
  execute: async (
    _params: {
      question: string;
      header: string;
      options: { label: string; description?: string }[];
    },
    _ctx: unknown,
  ) => {
    // The tool result doesn't matter much — the frontend intercepts the tool call args
    // and renders the question card. The user's answer comes as the next message.
    return toolResult({
      status: "question_presented",
      message: "Waiting for customer response.",
    });
  },
};

export const askUserQuestionTools = [askUserQuestionTool];
```

**Step 2: Verify the file compiles**

Run: `deno check apps/api/src/tools/ask-user-question.ts` Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/tools/ask-user-question.ts
git commit -m "feat(api): add ask_user_question tool definition"
```

---

### Task 2: Register the tool in the agent

**Files:**

- Modify: `apps/api/src/agent.ts` (lines 9, 43)

**Step 1: Add the import**

At line 9 (after the estimate import), add:

```typescript
import { askUserQuestionTools } from "./tools/ask-user-question.ts";
```

**Step 2: Add to allTools array**

In the `allTools` array (line 43), add `...askUserQuestionTools` at the top:

```typescript
const allTools = [
  ...askUserQuestionTools,
  ...serviceTools,
  ...estimateTools,
  ...(config.stripeSecretKey ? createStripeTools(config.stripeSecretKey) : []),
  ...schedulingTools,
];
```

**Step 3: Verify compilation**

Run: `deno task check:api` Expected: No errors

**Step 4: Commit**

```bash
git add apps/api/src/agent.ts
git commit -m "feat(api): register ask_user_question tool in agent"
```

---

### Task 3: Add system prompt guidance

**Files:**

- Modify: `apps/api/src/system-prompt.ts`

**Step 1: Add ask_user_question guidance**

After the `## Workflow` section (before `### Service Inquiries`), add:

```
### Using Structured Questions
When you need the customer to choose from a set of known options, use the ask_user_question tool instead of typing out the options in text. This shows them clickable buttons.

Use it for:
- Selecting a service from a list
- Confirming an action (e.g. "Proceed with estimate?" → Yes / No)
- Choosing between scheduling options

Do NOT use it for:
- Open-ended questions (e.g. "What's wrong with your car?")
- Asking for vehicle info (make, model, year)
- Anything where the answer isn't a fixed set of choices
```

**Step 2: Verify compilation**

Run: `deno task check:api` Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/system-prompt.ts
git commit -m "feat(api): add system prompt guidance for ask_user_question"
```

---

### Task 4: Add tool display name

**Files:**

- Modify: `apps/web/lib/agent-tools.ts` (line 11)

**Step 1: Add the display name**

Add to the `toolDisplayNames` record:

```typescript
ask_user_question: "Asking a question",
```

**Step 2: Commit**

```bash
git add apps/web/lib/agent-tools.ts
git commit -m "feat(web): add ask_user_question display name"
```

---

### Task 5: Create the QuestionCard component

**Files:**

- Create: `apps/web/components/QuestionCard.tsx`

**Step 1: Create the component**

```tsx
// apps/web/components/QuestionCard.tsx
"use client";

import { motion } from "framer-motion";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionData {
  question: string;
  header: string;
  options: QuestionOption[];
}

interface QuestionCardProps {
  data: QuestionData;
  onSelect: (label: string) => void;
  disabled?: boolean;
}

export function QuestionCard({ data, onSelect, disabled }: QuestionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="flex justify-start"
    >
      <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-surface-alt border border-border px-5 py-4">
        <p className="text-xs font-medium text-red-primary uppercase tracking-wide mb-1">
          {data.header}
        </p>
        <p className="text-sm text-text mb-3">{data.question}</p>
        <div className="flex flex-col gap-2">
          {data.options.map((option) => (
            <motion.button
              key={option.label}
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={disabled}
              onClick={() => onSelect(option.label)}
              className="w-full text-left px-4 py-3 rounded-xl border border-border bg-surface hover:border-red-primary/50 hover:bg-red-light/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-sm font-medium text-text">
                {option.label}
              </span>
              {option.description && (
                <span className="block text-xs text-text-secondary mt-0.5">
                  {option.description}
                </span>
              )}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
```

**Step 2: Verify compilation**

Run: `cd apps/web && bun run typecheck` Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/components/QuestionCard.tsx
git commit -m "feat(web): add QuestionCard component"
```

---

### Task 6: Wire up the hook to intercept tool calls

**Files:**

- Modify: `apps/web/hooks/useAgentChat.ts`

**Step 1: Add QuestionData import and state**

At the top of the file, add the import:

```typescript
import type { QuestionData } from "@/components/QuestionCard";
```

Add to the hook state (after `currentTool` state):

```typescript
const [pendingQuestion, setPendingQuestion] = useState<QuestionData | null>(null);
```

**Step 2: Intercept tool call in onToolCallEndEvent**

Replace the existing `onToolCallEndEvent` handler:

```typescript
onToolCallEndEvent: ({ event, toolCallName, toolCallArgs }) => {
  if (toolCallName === "ask_user_question") {
    setPendingQuestion(toolCallArgs as QuestionData);
  }
  setCurrentTool(null);
},
```

**Step 3: Add answerQuestion function**

After the `sendMessage` function, add:

```typescript
function answerQuestion(answer: string) {
  setPendingQuestion(null);
  sendMessage(answer);
}
```

**Step 4: Expose new state and function in return**

Add to the return object:

```typescript
return {
  messages,
  isLoading,
  error,
  currentTool,
  pendingQuestion,
  sendMessage,
  answerQuestion,
  clearMessages,
  clearError,
};
```

**Step 5: Update clearMessages to also clear pending question**

```typescript
function clearMessages() {
  setMessages([]);
  setPendingQuestion(null);
  agentRef.current = null;
}
```

**Step 6: Verify compilation**

Run: `cd apps/web && bun run typecheck` Expected: No errors

**Step 7: Commit**

```bash
git add apps/web/hooks/useAgentChat.ts
git commit -m "feat(web): intercept ask_user_question tool calls in useAgentChat"
```

---

### Task 7: Render the QuestionCard in the chat page

**Files:**

- Modify: `apps/web/app/chat/page.tsx`

**Step 1: Add import**

Add at the top with other imports:

```typescript
import { QuestionCard } from "@/components/QuestionCard";
```

**Step 2: Destructure new hook values**

Update the `useAgentChat` destructure to include `pendingQuestion` and `answerQuestion`:

```typescript
const {
  messages,
  isLoading,
  error,
  currentTool,
  pendingQuestion,
  sendMessage,
  answerQuestion,
  clearMessages,
  clearError,
} = useAgentChat({ user: agentUser });
```

**Step 3: Render question card after messages, before tool indicator**

Insert between the `messages.map(...)` block and the `{/* Tool indicator */}` comment (around line
256):

```tsx
{/* Question card */}
<AnimatePresence>
  {pendingQuestion && (
    <QuestionCard
      data={pendingQuestion}
      onSelect={answerQuestion}
      disabled={isLoading}
    />
  )}
</AnimatePresence>;
```

**Step 4: Disable text input while question is pending**

Update the input `disabled` prop (around line 341):

```tsx
disabled={!isConnected || isLoading || !!pendingQuestion}
```

And the submit button disabled prop:

```tsx
disabled={!isConnected || isLoading || !input.trim() || !!pendingQuestion}
```

**Step 5: Verify compilation**

Run: `cd apps/web && bun run typecheck` Expected: No errors

**Step 6: Run full build**

Run: `cd apps/web && bun run build` Expected: Build succeeds

**Step 7: Commit**

```bash
git add apps/web/app/chat/page.tsx
git commit -m "feat(web): render QuestionCard in chat UI"
```

---

### Task 8: Full CI verification

**Step 1: Run all checks**

```bash
cd apps/web && bun run lint
cd apps/web && bun run typecheck
cd apps/web && bun run build
deno task check:api
deno task check:diagnostic
```

Expected: All pass

**Step 2: Manual smoke test (optional)**

Start both servers and test the flow:

```bash
# Terminal 1
deno task dev:api

# Terminal 2
cd apps/web && bun run dev
```

Open chat, send "What services do you offer?" — the agent should call `ask_user_question` with
service options rendered as clickable buttons.
