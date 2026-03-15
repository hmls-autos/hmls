# Quality Guidelines

> Code standards and quality checks for backend development.

---

## Overview

Backend apps use Deno's built-in toolchain for formatting, linting, and type checking. The web app
(Next.js) uses Biome. A pre-commit hook enforces all checks before push.

---

## Formatting & Linting

### Deno Apps (API, Fixo Agent)

Configured in root `deno.json`:

| Setting    | Value          |
| ---------- | -------------- |
| Indent     | 2 spaces       |
| Line width | 100 characters |
| Quotes     | Double         |
| Semicolons | Enabled        |

```bash
deno fmt                    # Format
deno fmt --check            # Check formatting
deno lint                   # Lint
deno task check:api         # Type check API
deno task check:fixo        # Type check fixo
```

### Lint Pragmas

Use `// deno-lint-ignore <rule>` when suppression is needed:

```typescript
// deno-lint-ignore require-await
async function handler() { ... }
```

---

## Pre-Commit Hook

Located at `.githooks/pre-commit`, runs five checks sequentially:

1. Biome lint (`apps/web`)
2. TypeScript check (`apps/web`)
3. Next.js build (`apps/web`)
4. `deno check` (API)
5. `deno check` (fixo)

Enable with: `git config core.hooksPath .githooks`

---

## TypeScript

- **Strict mode** across all packages (Deno default)
- All function parameters must be typed
- Tool schemas use **Zod** with `.describe()` annotations for AI agent context

---

## Dependency Management

- **Root `deno.json`** holds shared dependencies (Hono, Zod, Drizzle, Stripe, rxjs)
- **App-specific deps** go in each app's `deno.json`
- Root `imports` are inherited by all workspace members

```bash
# Update Deno deps: change versions in deno.json, then:
deno install
```

---

## Lazy Initialization Pattern

Used consistently for expensive clients to avoid startup errors when env vars are missing:

```typescript
// Proxy-based lazy init (packages/shared/src/db/client.ts)
const handler = {
  get(_target: object, prop: string) {
    if (!instance) instance = createInstance();
    return Reflect.get(instance, prop);
  },
};
export const db = new Proxy({}, handler);
```

Applied to: DB client, Supabase client, Stripe client, R2 S3Client.

---

## Environment Validation

- **API app**: Imperative `if (!VAR)` checks in `index.ts` at startup
- Required vars throw immediately; optional vars log `[config]` warnings

---

## Testing

Minimal test infrastructure currently exists:

- **Fixo agent**: Integration tests in `apps/agent/src/test/integration.test.ts` using `@std/assert`
- Run with: `deno task --cwd apps/agent test`
- **API app**: No test files

---

## Forbidden Patterns

- Do not push code that fails `deno check`
- Do not add shared dependencies to individual app `deno.json` — put them in root `deno.json`
- Do not eagerly initialize expensive clients — use the lazy Proxy pattern
- Do not use `any` type — prefer `unknown` and narrow with type guards
