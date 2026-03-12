# Logging Guidelines

> Structured logging, log levels, what to log.

---

## Overview

No structured logging library is used. The codebase uses `console.log`, `console.error`, and
`console.warn` with a **bracketed-prefix convention**. The API app uses Hono's built-in `logger()`
middleware for HTTP request logging.

---

## Prefix Format

```
[component] message
```

Where `component` identifies the subsystem.

---

## Log Categories

| Prefix      | Level           | Usage                     | Example                                      |
| ----------- | --------------- | ------------------------- | -------------------------------------------- |
| `[server]`  | `console.log`   | Server lifecycle          | `[server] HMLS Agent running on Deno Deploy` |
| `[agent]`   | `console.log`   | Agent operations          | `[agent] threadId=abc, messages=5, user=123` |
| `[stripe]`  | `console.log`   | Stripe API calls          | `[stripe] Using cached customer: cus_123`    |
| `[billing]` | `console.error` | Billing errors            | `[billing] Checkout error: ...`              |
| `[config]`  | `console.warn`  | Missing optional env vars | `[config] Optional env var X is not set`     |
| `[error]`   | `console.error` | Global error handler      | `[error] NOT_FOUND: Estimate 123 not found`  |

---

## HTTP Request Logging

The API app uses Hono's built-in logger middleware:

```typescript
// apps/api/src/index.ts
import { logger } from "hono/logger";
app.use("*", logger());
```

All new Hono apps should include this middleware.

---

## Conventions

1. **Always use a bracketed prefix** to identify the subsystem
2. **Use `console.error` for errors**, `console.warn` for warnings, `console.log` for info
3. **Include relevant context** in log messages (IDs, counts, status codes)
4. **Log external API calls** with method and endpoint

---

## Forbidden Patterns

- Do not use `console.log` for error conditions — use `console.error`
- Do not omit the `[prefix]` bracket on log messages
- Do not forget to add `logger()` middleware to new Hono apps
