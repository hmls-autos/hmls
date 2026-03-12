# State Management

> Local state, global state, and server state patterns.

---

## Overview

The codebase deliberately uses **no external state management library** (no Zustand, Redux, Jotai).
State is managed through three mechanisms: React Context for global auth, SWR for server state, and
`useState` for component-local state.

---

## State Categories

### 1. Global Auth State — React Context

A single React Context provides authentication state:

```typescript
// apps/web/components/AuthProvider.tsx
type AuthContextType = {
  user: User | null;
  session: Session | null;
  supabase: ReturnType<typeof createClient>;
  isLoading: boolean;
};
```

Provider wraps the app at `apps/web/app/layout.tsx`:

```tsx
<AuthProvider>
  <Navbar />
  {children}
  <ChatWidget />
</AuthProvider>;
```

Consumer hook with guard:

```typescript
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
```

### 2. Theme State — next-themes

```typescript
// apps/web/app/layout.tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>

// Consumed via:
const { theme, setTheme } = useTheme();
```

### 3. Server State — SWR

SWR handles data caching and revalidation. No API data is stored in React state directly:

```typescript
const { customer, isLoading, isError, mutate } = useCustomer(id);
const { estimate, isLoading, isError, mutate } = useEstimate(id);
```

### 4. Component-Local State — useState

All other state is local:

```typescript
const [input, setInput] = useState("");
const [isOpen, setIsOpen] = useState(false);
const [isLoading, setIsLoading] = useState(false);
```

---

## Forbidden Patterns

- Do not introduce a state management library — the codebase deliberately avoids them
- Do not lift local state into context unless it truly needs to be global
- Do not store API data in `useState` — use SWR hooks
- Do not create new React Contexts without strong justification
