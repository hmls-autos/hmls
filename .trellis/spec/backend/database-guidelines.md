# Database Guidelines

> ORM patterns, queries, migrations, and naming conventions.

---

## Overview

Uses **Drizzle ORM** with **Supabase PostgreSQL**. The shared `@hmls/shared/db` package provides a
lazy-init `createDbClient(schema)` factory. Each app has its own `schema.ts` and `client.ts`.

---

## Schema Conventions

### Table Definitions

```typescript
// apps/api/src/db/schema.ts
import { integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: varchar("email", { length: 255 }).notNull().unique(),
  phone: varchar("phone", { length: 50 }),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Naming Rules

| Item          | Convention                                                               | Example                                                             |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Table names   | `snake_case`, plural                                                     | `diagnostic_sessions`, `customers`                                  |
| Column names  | `snake_case` in DB, `camelCase` in TypeScript                            | `labor_hours` -> `laborHours`                                       |
| Primary keys  | `serial("id").primaryKey()` or `uuid("id").primaryKey().defaultRandom()` | API uses `serial`; diagnostic uses `uuid`                           |
| Timestamps    | `timestamp("created_at").defaultNow().notNull()`                         | Every table has `createdAt`                                         |
| Foreign keys  | Inline `.references(() => table.id)`                                     | `customerId: integer("customer_id").references(() => customers.id)` |
| Money         | `integer` in **cents**                                                   | `totalAmount: integer("total_amount").notNull()`                    |
| JSON columns  | `jsonb` with inline comment documenting shape                            | `items: jsonb("items").notNull()`                                   |
| Status fields | `varchar` with string union (API) or `pgEnum` (diagnostic)               | `varchar("status", { length: 50 }).default("draft")`                |

### Inferred Types

Export `$inferSelect` and `$inferInsert` types from schema files:

```typescript
// apps/diagnostic-agent/src/db/schema.ts
export type DiagnosticSession = typeof diagnosticSessions.$inferSelect;
export type NewDiagnosticSession = typeof diagnosticSessions.$inferInsert;
```

### Indexes

Define in the third argument to `pgTable`:

```typescript
export const vehicles = pgTable("vehicles", { ... }, (table) => [
  index("idx_vehicles_user").on(table.userId),
]);
```

---

## Client Pattern

Both apps use the same two-line `client.ts`:

```typescript
// apps/api/src/db/client.ts
import { createDbClient } from "@hmls/shared/db";
import * as schema from "./schema.ts";
export const db = createDbClient(schema);
export { schema };
```

The shared `createDbClient` uses a **lazy-init Proxy** so the DB connection is only created on first
use.

---

## Query Patterns

### Select (single record)

Destructure first element with `.limit(1)`:

```typescript
const [estimate] = await db
  .select()
  .from(schema.estimates)
  .where(eq(schema.estimates.id, id))
  .limit(1);
```

### Insert with returning

Always destructure to get the created record:

```typescript
const [created] = await db
  .insert(schema.customers)
  .values({ name, email, phone })
  .returning();
```

### Update

```typescript
await db
  .update(schema.customers)
  .set({ stripeCustomerId: stripeId })
  .where(eq(schema.customers.id, customerId));
```

### Aggregation (raw SQL)

```typescript
const [{ count }] = await db
  .select({ count: sql<number>`count(*)` })
  .from(diagnosticSessions)
  .where(
    and(eq(diagnosticSessions.userId, auth.userId), gte(diagnosticSessions.createdAt, monthStart)),
  );
```

---

## Migration Approach

Currently uses raw SQL in a single string, executed via `sql.unsafe()` in
`apps/api/src/db/migrate.ts`. No versioned migration files or rollback support.

---

## Forbidden Patterns

- Do not use the Drizzle relational query builder — use the SQL-like API exclusively
- Do not store money as floats — always use `integer` in cents
- Do not create DB connections outside of `client.ts` — always import from `db/client.ts`
