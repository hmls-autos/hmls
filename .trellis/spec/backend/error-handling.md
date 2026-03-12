# Error Handling

> How errors are caught, logged, and returned.

---

## Overview

The shared `@hmls/shared/errors` package provides a standardized error system. The API app uses it
consistently; the diagnostic-agent has some inconsistencies to be aware of.

---

## Shared Error System

**Location**: `packages/shared/src/lib/errors.ts`

### AppError Class

```typescript
class AppError extends Error {
  code: ErrorCode;
  message: string;
  details?: string;
  status: number; // computed from code
}
```

### ErrorCode Enum

`BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR`,
`EXTERNAL_SERVICE_ERROR`, `DATABASE_ERROR`

### Errors Factory

```typescript
import { Errors } from "@hmls/shared/errors";

throw Errors.notFound("Estimate", id);
throw Errors.badRequest("Invalid input");
throw Errors.validation("Invalid AG-UI input", details);
throw Errors.external("Stripe", `${response.status} - ${error}`);
throw Errors.internal("Unexpected state");
throw Errors.database("Query failed");
```

### Error Response Shape

```json
{ "error": { "code": "NOT_FOUND", "message": "Estimate 123 not found" } }
```

---

## Global Error Handler (API)

The API app catches all thrown errors in `app.onError`:

```typescript
// apps/api/src/index.ts
app.onError((err, c) => {
  if (err instanceof AppError) {
    console.error(`[error] ${err.code}: ${err.message}`);
    return c.json(err.toJSON(), err.status);
  }
  console.error(`[error] Unhandled:`, err);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
});
```

---

## Error Patterns

### 1. Throw `Errors.*` (preferred — caught by global handler)

```typescript
// apps/api/src/routes/estimates.ts
if (!estimate) throw Errors.notFound("Estimate", id);
```

### 2. Return `c.json` for validation/auth (inline early returns)

```typescript
// apps/api/src/routes/estimates.ts
if (isNaN(id)) {
  return c.json({ error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } }, 400);
}
```

### 3. Tool-level errors (return result, don't throw)

Tools return error information so the AI agent can recover:

```typescript
// apps/api/src/skills/estimate/tools.ts
return toolResult({ success: false, error: "Customer not found" });
```

### 4. Stream errors (emit RUN_ERROR event)

Both chat endpoints wrap SSE streams with try/catch and emit AG-UI `RUN_ERROR` events on failure.

---

## Forbidden Patterns

- Do not return `{ error: "string" }` — always use `{ error: { code, message } }` format
- Do not return raw `new Response()` in Hono routes — use `c.json()` to stay in the Hono middleware
  chain
- Do not throw errors inside AI tools — return error info in `toolResult()` so the agent can handle
  it
- Do not skip the global `app.onError` handler in new Deno apps — add it to every Hono app
