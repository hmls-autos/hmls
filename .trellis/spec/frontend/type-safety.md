# Type Safety

> TypeScript conventions and type organization.

---

## Overview

TypeScript strict mode is enabled. Types are always co-located with their consumers. The frontend
uses **no Zod** — all types are compile-time only.

---

## TypeScript Config

```json
// apps/web/tsconfig.json
{ "compilerOptions": { "strict": true } }
```

---

## Type Import Style

Always use `import type` for type-only imports:

```typescript
// Standalone type import
import type { Metadata } from "next";
import type { Session, User } from "@supabase/supabase-js";

// Mixed import with inline type keyword
import { HttpAgent, type Message as AgentMessage } from "@ag-ui/client";
import { type ReactNode, useEffect, useRef } from "react";
```

---

## Interface vs Type

### `interface` — Props and Data Shapes

```typescript
interface ServiceCardProps {
  title: string;
  description: string;
  price: string;
  href?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}
```

### `type` — Aliases, Unions, Context Types

```typescript
type AuthContextType = {
  user: User | null;
  session: Session | null;
  supabase: ReturnType<typeof createClient>;
  isLoading: boolean;
};

type Step = "email" | "password";
```

---

## Type Colocation

Types are always defined in the same file where they are consumed. There is no `types/` directory:

- Props interfaces: above the component in the same file
- Hook types: in the hook file
- Exported types: from the component/hook that defines them

```typescript
// apps/web/components/QuestionCard.tsx — exports interfaces alongside component
export interface QuestionOption { ... }
export interface QuestionData { ... }
export function QuestionCard() { ... }
```

---

## Generics

Used with SWR and the shared fetcher:

```typescript
useSWR<Customer>(key, fetcher);
useSWR<Estimate>(key, fetcher);

async function fetcher<T>(path: string): Promise<T> { ... }
```

---

## Forbidden Patterns

- Do not use `any` — prefer `unknown` and narrow with type guards
- Do not create a separate `types/` directory — co-locate types with consumers
- Do not use `interface` for simple union/alias types — use `type`
- Do not add Zod to the frontend — runtime validation is not used on the client
