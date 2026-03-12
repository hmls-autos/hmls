# Social Login Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Add OAuth social login (Google, Apple, Facebook, GitHub, Discord, Twitter/X) to the HMLS
web app using Supabase Auth, with automatic customer record sync.

**Architecture:** Supabase handles OAuth flows natively. The Next.js `/auth/callback` route
exchanges the OAuth code for a session, then calls the Deno API to match/create a customer record by
email. The login page gets social login buttons above the existing email/password form.

**Tech Stack:** Supabase Auth OAuth, Next.js App Router, Drizzle ORM (Neon DB), `@supabase/ssr`

**Note:** `customers` table is in Neon DB, `auth.users` is in Supabase DB. Cross-DB triggers aren't
possible, so customer sync happens server-side in the callback route via the Deno API.

---

### Task 1: Configure Supabase URL Settings (Manual — Dashboard)

This task is manual and cannot be automated via code.

**Step 1: Update Site URL**

Go to Supabase Dashboard > Authentication > URL Configuration:

- Set **Site URL** to `https://hmls.autos`

**Step 2: Add Redirect URLs**

Add these to the **Redirect URLs** list:

- `http://localhost:3000/**`
- `https://hmls.autos/**`

**Step 3: Verify**

Confirm the settings are saved. This fixes the confirmation email localhost issue and enables OAuth
redirects.

---

### Task 2: Add `auth_user_id` Column to Customers Table (Neon DB)

**Files:**

- Modify: `apps/api/src/db/schema.ts:25-34`
- Create: `apps/api/src/db/migrations/XXXX_add_auth_user_id.ts` (via Drizzle generate)

**Step 1: Update the schema**

In `apps/api/src/db/schema.ts`, add `authUserId` to the `customers` table:

```typescript
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  address: text("address"),
  vehicleInfo: jsonb("vehicle_info"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 100 }),
  authUserId: varchar("auth_user_id", { length: 255 }).unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Step 2: Generate and run migration**

```bash
deno task --cwd apps/api db:migrate
```

If there's no Drizzle migration generate command, run the SQL directly:

```sql
ALTER TABLE customers ADD COLUMN auth_user_id VARCHAR(255) UNIQUE;
```

**Step 3: Commit**

```bash
git add apps/api/src/db/schema.ts
git commit -m "feat(db): add auth_user_id column to customers table"
```

---

### Task 3: Add Customer Sync API Endpoint (Deno API)

**Files:**

- Create: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/routes/index.ts` (mount the new router)

**Step 1: Create the auth route**

Create `apps/api/src/routes/auth.ts`:

```typescript
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.ts";

const app = new Hono();

/**
 * POST /auth/sync
 * Called by the web app's OAuth callback to match/create a customer record.
 * Body: { authUserId: string, email: string, name?: string, phone?: string }
 */
app.post("/sync", async (c) => {
  const { authUserId, email, name, phone } = await c.req.json();

  if (!authUserId || !email) {
    return c.json({ error: "authUserId and email are required" }, 400);
  }

  // Check if already linked
  const existingByAuthId = await db.query.customers.findFirst({
    where: eq(schema.customers.authUserId, authUserId),
  });

  if (existingByAuthId) {
    return c.json({ customer: existingByAuthId });
  }

  // Try to match by email
  const existingByEmail = await db.query.customers.findFirst({
    where: eq(schema.customers.email, email),
  });

  if (existingByEmail) {
    // Link existing customer to auth user
    const [updated] = await db
      .update(schema.customers)
      .set({ authUserId })
      .where(eq(schema.customers.id, existingByEmail.id))
      .returning();
    return c.json({ customer: updated });
  }

  // Create new customer
  const [newCustomer] = await db
    .insert(schema.customers)
    .values({
      authUserId,
      email,
      name: name || null,
      phone: phone || null,
    })
    .returning();

  return c.json({ customer: newCustomer }, 201);
});

export default app;
```

**Step 2: Mount the router**

In `apps/api/src/routes/index.ts`, add:

```typescript
import auth from "./auth.ts";
// ... existing imports

// ... existing routes
app.route("/auth", auth);
```

Check the existing file first to see the exact mount pattern.

**Step 3: Verify the API compiles**

```bash
deno task check:api
```

**Step 4: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/src/routes/index.ts
git commit -m "feat(api): add POST /auth/sync endpoint for customer matching"
```

---

### Task 4: Create OAuth Callback Route (Next.js)

**Files:**

- Create: `apps/web/app/auth/callback/route.ts`

**Step 1: Create the callback route**

Create `apps/web/app/auth/callback/route.ts`:

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/chat";

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next;
  redirectTo.searchParams.delete("code");
  redirectTo.searchParams.delete("next");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Sync user to customer record via API
      const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8080";
      try {
        await fetch(`${agentUrl}/auth/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authUserId: data.user.id,
            email: data.user.email,
            name: data.user.user_metadata?.full_name || data.user.user_metadata?.name,
            phone: data.user.user_metadata?.phone,
          }),
        });
      } catch {
        // Non-blocking: customer sync failure shouldn't prevent login
        console.error("Failed to sync customer record");
      }

      return NextResponse.redirect(redirectTo);
    }
  }

  // Auth failed — redirect to login with error
  redirectTo.pathname = "/login";
  redirectTo.searchParams.set("error", "Could not authenticate");
  return NextResponse.redirect(redirectTo);
}
```

**Step 2: Verify it compiles**

```bash
cd apps/web && bun run typecheck
```

**Step 3: Commit**

```bash
git add apps/web/app/auth/callback/route.ts
git commit -m "feat(web): add OAuth callback route with customer sync"
```

---

### Task 5: Add Social Login Buttons to Login Page

**Files:**

- Modify: `apps/web/app/login/page.tsx`

**Step 1: Add the social login provider config and handler**

At the top of the component (after the existing state variables), add:

```typescript
const providers = [
  { id: "google" as const, label: "Google", color: "#4285F4", icon: "G" },
  { id: "apple" as const, label: "Apple", color: "#000000", icon: "" },
  { id: "facebook" as const, label: "Facebook", color: "#1877F2", icon: "f" },
  { id: "github" as const, label: "GitHub", color: "#333333", icon: null },
  { id: "discord" as const, label: "Discord", color: "#5865F2", icon: null },
  { id: "twitter" as const, label: "Twitter", color: "#000000", icon: "𝕏" },
];

const handleOAuthLogin = async (provider: typeof providers[number]["id"]) => {
  setIsLoading(true);
  setError(null);
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) {
    setError(error.message);
    setIsLoading(false);
  }
};
```

**Step 2: Add the social buttons UI**

Insert this block between the header `<div>` and the `<motion.form>`, right after the closing
`</div>` of the header section (after line ~95):

```tsx
{/* Social Login Buttons */}
<div className="space-y-3 mb-6">
  {providers.map((provider) => (
    <motion.button
      key={provider.id}
      type="button"
      onClick={() => handleOAuthLogin(provider.id)}
      disabled={isLoading}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border border-border bg-surface text-text font-medium hover:bg-surface/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span
        className="w-5 h-5 flex items-center justify-center text-sm font-bold"
        style={{ color: provider.color }}
      >
        {provider.icon}
      </span>
      Continue with {provider.label}
    </motion.button>
  ))}
</div>;

{/* Divider */}
<div className="relative mb-6">
  <div className="absolute inset-0 flex items-center">
    <div className="w-full border-t border-border" />
  </div>
  <div className="relative flex justify-center text-sm">
    <span className="bg-background px-4 text-text-secondary">
      or continue with email
    </span>
  </div>
</div>;
```

**Step 3: Handle error query param from callback**

Add at the top of the component (after hooks):

```typescript
// Check for error from OAuth callback
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const callbackError = params.get("error");
  if (callbackError) {
    setError(callbackError);
    // Clean up URL
    window.history.replaceState({}, "", "/login");
  }
}, []);
```

Note: will need to add `useEffect` to the React import if not already imported.

**Step 4: Verify it compiles and builds**

```bash
cd apps/web && bun run typecheck && bun run build
```

**Step 5: Commit**

```bash
git add apps/web/app/login/page.tsx
git commit -m "feat(web): add social login buttons to login page"
```

---

### Task 6: Enable OAuth Providers in Supabase Dashboard (Manual)

This task is manual. For each provider, go to Supabase Dashboard > Authentication > Providers and
enable + configure:

**Step 1: Google**

- Go to [Google Cloud Console](https://console.cloud.google.com/) > APIs & Services > Credentials
- Create OAuth 2.0 Client ID (Web application)
- Authorized redirect URI: `https://ddkapmjkubklyzuciscd.supabase.co/auth/v1/callback`
- Copy Client ID and Client Secret into Supabase dashboard

**Step 2: Apple**

- Go to [Apple Developer](https://developer.apple.com/) > Certificates, Identifiers & Profiles
- Create a Services ID, enable "Sign in with Apple"
- Configure the redirect: `https://ddkapmjkubklyzuciscd.supabase.co/auth/v1/callback`
- Generate a private key, copy credentials into Supabase

**Step 3: Facebook**

- Go to [Meta Developers](https://developers.facebook.com/)
- Create an app, add Facebook Login product
- Valid OAuth Redirect URI: `https://ddkapmjkubklyzuciscd.supabase.co/auth/v1/callback`
- Copy App ID and App Secret into Supabase

**Step 4: GitHub**

- Go to GitHub Settings > Developer Settings > OAuth Apps
- Authorization callback URL: `https://ddkapmjkubklyzuciscd.supabase.co/auth/v1/callback`
- Copy Client ID and Client Secret into Supabase

**Step 5: Discord**

- Go to [Discord Developer Portal](https://discord.com/developers/applications)
- Create application, add redirect: `https://ddkapmjkubklyzuciscd.supabase.co/auth/v1/callback`
- Copy Client ID and Client Secret into Supabase

**Step 6: Twitter/X**

- Go to [Twitter Developer Portal](https://developer.twitter.com/)
- Create a project/app with OAuth 2.0 enabled
- Callback URL: `https://ddkapmjkubklyzuciscd.supabase.co/auth/v1/callback`
- Copy Client ID and Client Secret into Supabase

---

### Task 7: Run Full CI Suite and Verify

**Step 1: Lint**

```bash
cd apps/web && bun run lint
```

**Step 2: Typecheck**

```bash
cd apps/web && bun run typecheck
```

**Step 3: Build**

```bash
cd apps/web && bun run build
```

**Step 4: Check API**

```bash
deno task check:api
```

**Step 5: Check diagnostic**

```bash
deno task check:diagnostic
```

**Step 6: Manual test**

Start dev servers and test:

1. Navigate to `/login` — social buttons should appear above email form
2. Click "Continue with GitHub" (easiest to set up) — should redirect to GitHub OAuth
3. After authorizing, should redirect back to `/auth/callback` → `/chat`
4. Check that a customer record was created/linked in Neon DB
