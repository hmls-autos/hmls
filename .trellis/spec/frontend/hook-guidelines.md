# Hook Guidelines

> Custom hook naming, data fetching patterns, and conventions.

---

## Overview

All custom hooks live in `apps/web/hooks/`. Data fetching uses **SWR** with a shared `fetcher` that
auto-injects Supabase auth tokens. Exception: `useAuth` is co-located with `AuthProvider`.

---

## Naming

`use` prefix + PascalCase entity name:

- `useAgentChat` — complex stateful chat logic
- `useCustomer` — SWR data fetching for customer
- `useEstimate` — SWR data fetching for estimate

---

## Data Fetching Pattern (SWR)

All data fetching hooks follow this exact pattern:

```typescript
// apps/web/hooks/useCustomer.ts
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface Customer {
  id: number;
  name: string | null;
  email: string;
  phone: string | null;
}

export function useCustomer(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<Customer>(
    id ? `/api/customers/${id}` : null, // null key = don't fetch
    fetcher,
  );

  return {
    customer: data,
    isLoading,
    isError: !!error,
    mutate,
  };
}
```

### Return Shape Convention

Always return: `{ entityName, isLoading, isError, mutate }`

### Shared Fetcher

`apps/web/lib/fetcher.ts` automatically injects the Supabase auth token into all API requests:

```typescript
export async function fetcher<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const { data: { session } } = await getSupabase().auth.getSession();
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${AGENT_URL}${path}`, { headers });
  if (!res.ok) {
    const error = new Error("Fetch failed") as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}
```

---

## Complex State Hooks

For hooks with multiple state slices and callbacks (e.g., `useAgentChat`):

1. **Options object** for configuration:
   ```typescript
   interface UseAgentChatOptions {
     scrollRef?: RefObject<HTMLElement | null>;
     inputRef?: RefObject<HTMLInputElement | null>;
     accessToken?: string | null;
   }
   ```

2. **Multiple `useState`** for independent state slices

3. **`useCallback`** for all exposed functions

4. **`useRef`** for mutable state that should not trigger re-renders

---

## Forbidden Patterns

- Do not use `useEffect` for data fetching — use SWR hooks
- Do not create hooks outside the `hooks/` directory (except context-coupled hooks like `useAuth`)
- Do not forget `useCallback` wrapping for functions returned from hooks
- Do not fetch without auth — always use the shared `fetcher` which injects tokens
