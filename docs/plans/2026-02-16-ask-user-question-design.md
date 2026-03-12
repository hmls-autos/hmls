# Ask User Question Tool — Design

## Problem

The HMLS agent asks freeform text questions when it needs structured input (service selection,
confirmations). Customers must type answers instead of tapping a choice. This slows down
conversations and introduces ambiguity.

## Solution

Add an `ask_user_question` tool the agent can call to present structured, clickable question cards
in the chat UI. The frontend intercepts the tool call args and renders interactive option buttons
instead of a spinner.

## Architecture

### Approach: Tool Call with Frontend Rendering

The AG-UI protocol already streams tool call events with args. The frontend detects
`ask_user_question` tool calls, parses the args into question data, and renders a card. No protocol
changes needed.

### Flow

```
1. Agent decides it needs structured input
2. Agent calls ask_user_question({ questions: [...] })
3. AG-UI streams onToolCallStartEvent with tool args
4. Frontend detects tool name, parses args, renders question card
5. User clicks an option
6. Frontend sends the selection as the next user message
7. Agent receives the answer and continues
```

### Tool Schema

```typescript
{
  name: "ask_user_question",
  schema: z.object({
    questions: z.array(z.object({
      question: z.string().describe("The question to ask"),
      header: z.string().describe("Short label for the question"),
      options: z.array(z.object({
        label: z.string().describe("Display text for this option"),
        description: z.string().optional().describe("Additional context"),
      })).min(2).max(6),
      multiSelect: z.boolean().default(false),
    })).min(1).max(1),  // Single question per call
  }),
  execute: returns tool result indicating user response will follow
}
```

### Use Cases

- **Service selection**: "Which service do you need?" with service options
- **Confirmations**: "Proceed with this estimate?" Yes/No
- **Rush/scheduling**: "Standard or rush scheduling?"

## Files to Create/Modify

| File                                      | Change                                     |
| ----------------------------------------- | ------------------------------------------ |
| `apps/api/src/tools/ask-user-question.ts` | New tool definition                        |
| `apps/api/src/agent.ts`                   | Register the tool                          |
| `apps/api/src/system-prompt.ts`           | Guidance on when to use it                 |
| `apps/web/hooks/useAgentChat.ts`          | Intercept tool call, expose question state |
| `apps/web/app/chat/page.tsx`              | Render question card                       |
| `apps/web/components/QuestionCard.tsx`    | New interactive card component             |
| `apps/web/lib/agent-tools.ts`             | Add display name                           |
