# Diagnostic SaaS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Build an independent SaaS product — an AI-powered vehicle diagnostic PWA with Freemium
pricing (Free + Plus $19.99/mo).

**Architecture:** Monorepo extension. New `apps/diagnostic-web/` Next.js PWA frontend communicates
with enhanced `apps/diagnostic-agent/` Hono API backend. Supabase Auth for users, Stripe
Subscriptions for billing, existing AG-UI streaming protocol for real-time chat.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS 4, Supabase Auth (`@supabase/ssr`),
AG-UI (`@ag-ui/client`), Stripe Subscriptions, Drizzle ORM, Hono, Deno Deploy.

**Design Doc:** `docs/plans/2026-02-17-diagnostic-saas-design.md`

---

## Phase 1: Core MVP

### Task 1: Scaffold `apps/diagnostic-web` Next.js PWA

**Files:**

- Create: `apps/diagnostic-web/package.json`
- Create: `apps/diagnostic-web/next.config.ts`
- Create: `apps/diagnostic-web/tsconfig.json`
- Create: `apps/diagnostic-web/postcss.config.mjs`
- Create: `apps/diagnostic-web/biome.json`
- Create: `apps/diagnostic-web/lib/image-loader.ts`
- Create: `apps/diagnostic-web/src/app/globals.css`
- Create: `apps/diagnostic-web/src/app/layout.tsx`
- Create: `apps/diagnostic-web/src/app/page.tsx`
- Create: `apps/diagnostic-web/src/app/manifest.ts`

**Step 1: Create package.json**

```json
{
  "name": "diagnostic-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ag-ui/client": "0.0.45",
    "@ag-ui/core": "^0.0.45",
    "@supabase/ssr": "^0.8.0",
    "@supabase/supabase-js": "^2.95.3",
    "framer-motion": "^12.34.0",
    "lucide-react": "^0.564.0",
    "next": "16.1.6",
    "next-themes": "^0.4.6",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "react-markdown": "^10.1.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.15",
    "@tailwindcss/postcss": "^4.1.18",
    "@types/node": "^25.2.3",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "tailwindcss": "^4.1.18",
    "typescript": "^5.9.3"
  }
}
```

**Step 2: Create next.config.ts**

Copy pattern from `apps/web/next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
  },
};

export default nextConfig;
```

**Step 3: Create tsconfig.json, postcss.config.mjs, biome.json, image-loader.ts**

Copy directly from `apps/web/` — same patterns.

**Step 4: Create globals.css with diagnostic-specific design tokens**

Based on `apps/web/src/app/globals.css` but with a distinct brand color (blue instead of red for
differentiation):

```css
@import "tailwindcss";

:root {
  --background: #fafafa;
  --foreground: #171717;
  --primary: #2563eb; /* Blue — diagnostic brand */
  --primary-hover: #1d4ed8;
  --surface: #ffffff;
  --surface-alt: #f5f5f5;
  --border: #e5e5e5;
  --text: #171717;
  --text-secondary: #737373;
}

.dark {
  --background: #0a0a0a;
  --foreground: #fafaf9;
  --primary: #3b82f6;
  --primary-hover: #60a5fa;
  --surface: #1c1917;
  --surface-alt: #292524;
  --border: #44403c;
  --text: #fafaf9;
  --text-secondary: #a8a29e;
}
```

**Step 5: Create root layout, page, and PWA manifest**

Layout: ThemeProvider + AuthProvider shell (AuthProvider created in Task 3). Page: Simple redirect
to `/chat` or landing copy. Manifest: `display: "standalone"`, `start_url: "/chat"`, diagnostic
branding.

**Step 6: Install dependencies and verify dev server starts**

```bash
cd apps/diagnostic-web && bun install
cd apps/diagnostic-web && bun run dev
```

Expected: Next.js dev server on port 3001.

**Step 7: Verify build passes**

```bash
cd apps/diagnostic-web && bun run typecheck
cd apps/diagnostic-web && bun run build
```

**Step 8: Commit**

```bash
git add apps/diagnostic-web/
git commit -m "feat(diagnostic-web): scaffold Next.js PWA app"
```

---

### Task 2: Supabase Auth Setup

**Files:**

- Create: `apps/diagnostic-web/lib/supabase/client.ts`
- Create: `apps/diagnostic-web/lib/supabase/server.ts`
- Create: `apps/diagnostic-web/lib/supabase/middleware.ts`
- Create: `apps/diagnostic-web/middleware.ts`
- Create: `apps/diagnostic-web/src/app/auth/callback/route.ts`
- Create: `apps/diagnostic-web/src/app/auth/confirm/route.ts`

**Step 1: Create Supabase browser client**

Copy pattern from `apps/web/lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables");
  }
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
```

**Step 2: Create Supabase server client**

Copy from `apps/web/lib/supabase/server.ts`.

**Step 3: Create Supabase middleware helper**

Copy from `apps/web/lib/supabase/middleware.ts`.

**Step 4: Create root middleware.ts**

```typescript
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js).*)"],
};
```

**Step 5: Create auth callback and confirm routes**

Copy from `apps/web/src/app/auth/callback/route.ts` and `apps/web/src/app/auth/confirm/route.ts`.
Change default redirect to `/chat`.

**Step 6: Create .env.local**

```env
NEXT_PUBLIC_SUPABASE_URL=https://ddkapmjkubklyzuciscd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same key as apps/web>
NEXT_PUBLIC_AGENT_URL=http://localhost:8001
```

**Step 7: Verify build passes**

```bash
cd apps/diagnostic-web && bun run typecheck
```

**Step 8: Commit**

```bash
git add apps/diagnostic-web/lib/ apps/diagnostic-web/middleware.ts apps/diagnostic-web/src/app/auth/
git commit -m "feat(diagnostic-web): add Supabase auth setup"
```

---

### Task 3: AuthProvider Component + Login Page

**Files:**

- Create: `apps/diagnostic-web/src/components/AuthProvider.tsx`
- Create: `apps/diagnostic-web/src/app/(auth)/login/page.tsx`
- Modify: `apps/diagnostic-web/src/app/layout.tsx` (wrap with AuthProvider)

**Step 1: Create AuthProvider**

Copy pattern from `apps/web/src/components/AuthProvider.tsx`. Provides `useAuth()` hook with
`{ user, session, supabase, isLoading }`.

**Step 2: Create login page**

Simplified login page:

- Email + password form
- Google OAuth button
- Sign up / sign in toggle
- Redirect to `/chat` on success
- Mobile-optimized layout (full-screen, centered)

Reference `apps/web/src/app/login/page.tsx` for patterns but keep simpler — no multi-step flow.
Single form with email, password, and Google button.

**Step 3: Update root layout to wrap with AuthProvider and ThemeProvider**

```tsx
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/components/AuthProvider";

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**Step 4: Verify login flow works**

Start dev server, navigate to `/login`, test Google OAuth and email/password.

**Step 5: Commit**

```bash
git commit -m "feat(diagnostic-web): add auth provider and login page"
```

---

### Task 4: Database Migration — user_profiles + vehicles

**Files:**

- Create: `apps/diagnostic-agent/src/db/migrations/001_user_profiles.sql`
- Modify: `apps/diagnostic-agent/src/db/schema.ts` (add new tables)

**Step 1: Add schema definitions**

Add to `apps/diagnostic-agent/src/db/schema.ts`:

```typescript
// User tier enum
export const userTierEnum = pgEnum("user_tier", ["free", "plus"]);

// User profiles (extends Supabase auth.users)
export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  tier: userTierEnum("tier").default("free").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_user_profiles_stripe").on(table.stripeCustomerId),
]);

// Vehicles
export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => userProfiles.id),
  year: integer("year"),
  make: text("make").notNull(),
  model: text("model").notNull(),
  vin: text("vin"),
  nickname: text("nickname"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_vehicles_user").on(table.userId),
]);
```

**Step 2: Add user_id and vehicle_id columns to diagnostic_sessions**

```typescript
// Modify existing diagnosticSessions table definition to add:
userId: uuid("user_id").references(() => userProfiles.id),
vehicleId: uuid("vehicle_id").references(() => vehicles.id),
```

**Step 3: Apply migration via Supabase**

Use the Supabase MCP tool `apply_migration` to run the DDL.

**Step 4: Export new types**

```typescript
export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
```

**Step 5: Verify deno check passes**

```bash
deno task check:diagnostic
```

**Step 6: Commit**

```bash
git commit -m "feat(diagnostic): add user_profiles and vehicles schema"
```

---

### Task 5: Auth Middleware Overhaul — Support SaaS Users

**Files:**

- Modify: `apps/diagnostic-agent/src/middleware/auth.ts`
- Create: `apps/diagnostic-agent/src/middleware/tier.ts`
- Modify: `apps/diagnostic-agent/src/main.ts`

**Step 1: Refactor AuthContext type**

Update `apps/diagnostic-agent/src/middleware/auth.ts`:

```typescript
export interface AuthContext {
  userId: string; // Supabase auth.users.id
  email: string;
  tier: "free" | "plus";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  // Legacy support for existing HMLS customers
  customerId?: number;
}
```

**Step 2: Update authenticateRequest to check user_profiles first**

```typescript
export async function authenticateRequest(req: Request): Promise<AuthContext | Response> {
  const token = extractBearerToken(req);
  if (!token) return unauthorized("Missing authorization header");

  const authUser = await verifyToken(token);
  if (!authUser) return unauthorized("Invalid token");

  // Try user_profiles first (SaaS users)
  const [profile] = await db.select().from(userProfiles)
    .where(eq(userProfiles.id, authUser.id))
    .limit(1);

  if (profile) {
    return {
      userId: profile.id,
      email: authUser.email,
      tier: profile.tier,
      stripeCustomerId: profile.stripeCustomerId,
      stripeSubscriptionId: profile.stripeSubscriptionId,
    };
  }

  // Fallback: legacy HMLS customer lookup
  const [customer] = await db.select().from(customers)
    .where(eq(customers.email, authUser.email))
    .limit(1);

  if (customer) {
    return {
      userId: authUser.id,
      email: authUser.email,
      tier: "plus" as const, // legacy customers get full access
      stripeCustomerId: customer.stripeCustomerId,
      stripeSubscriptionId: null,
      customerId: customer.id,
    };
  }

  // Auto-create user_profiles for new SaaS users
  const [newProfile] = await db.insert(userProfiles)
    .values({ id: authUser.id })
    .returning();

  return {
    userId: newProfile.id,
    email: authUser.email,
    tier: "free",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  };
}
```

**Step 3: Create tier middleware**

Create `apps/diagnostic-agent/src/middleware/tier.ts`:

```typescript
import { db, schema } from "../db/client.ts";
import { and, eq, gte, sql } from "drizzle-orm";
import type { AuthContext } from "./auth.ts";

const FREE_LIMITS = { text: 3 } as const;

export async function checkFreeTierLimit(
  auth: AuthContext,
  inputType: string,
): Promise<Response | null> {
  if (auth.tier === "plus") return null; // Plus users: no limits

  const limit = FREE_LIMITS[inputType as keyof typeof FREE_LIMITS];
  if (limit === undefined) {
    // Free users can only use text
    return new Response(
      JSON.stringify({
        error: "upgrade_required",
        message: "Upgrade to Plus to use photo, audio, video, and OBD diagnostics",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // Count this month's usage
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(schema.diagnosticMedia)
    .where(and(
      eq(
        schema.diagnosticMedia.sessionId,
        sql`ANY(
        SELECT id FROM diagnostic_sessions WHERE user_id = ${auth.userId}
      )`,
      ),
      gte(schema.diagnosticMedia.createdAt, monthStart),
    ));

  if (Number(count) >= limit) {
    return new Response(
      JSON.stringify({
        error: "limit_reached",
        message:
          `Free plan limit reached (${limit} text diagnoses/month). Upgrade to Plus for unlimited access.`,
        usage: { used: Number(count), limit },
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return null; // Under limit, proceed
}
```

**Step 4: Update main.ts to use new auth context**

Update route handlers in sessions.ts and input.ts to use `auth.userId` instead of `auth.customerId`
for new SaaS user queries.

**Step 5: Verify**

```bash
deno task check:diagnostic
```

**Step 6: Commit**

```bash
git commit -m "feat(diagnostic): overhaul auth for SaaS user support"
```

---

### Task 6: Diagnostic Chat Page

**Files:**

- Create: `apps/diagnostic-web/src/hooks/useAgentChat.ts`
- Create: `apps/diagnostic-web/src/app/(app)/chat/page.tsx`
- Create: `apps/diagnostic-web/src/components/chat/MessageBubble.tsx`
- Create: `apps/diagnostic-web/src/components/chat/ChatInput.tsx`
- Create: `apps/diagnostic-web/src/components/chat/ToolIndicator.tsx`
- Create: `apps/diagnostic-web/src/components/ui/Markdown.tsx`
- Create: `apps/diagnostic-web/src/app/(app)/layout.tsx`

**Step 1: Create useAgentChat hook**

Copy pattern from `apps/web/src/hooks/useAgentChat.ts`. Key change: point to `NEXT_PUBLIC_AGENT_URL`
(port 8001 for diagnostic-agent, not 8080).

```typescript
const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8001";
```

**Step 2: Create MessageBubble component**

Renders user and assistant messages with proper styling. Assistant messages use Markdown component.

**Step 3: Create ChatInput component**

Mobile-first input with:

- Text input field
- Camera button (icon, wired up in Task 7)
- Send button
- Disabled state while loading

```tsx
<div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border p-3 safe-area-bottom">
  <div className="flex items-center gap-2 max-w-2xl mx-auto">
    <button onClick={onCameraClick} className="p-2.5 rounded-full bg-surface-alt">
      <Camera className="w-5 h-5" />
    </button>
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder="Describe your car problem..."
      className="flex-1 bg-surface-alt rounded-full px-4 py-2.5 text-sm"
    />
    <button type="submit" disabled={!value.trim() || isLoading}>
      <Send className="w-5 h-5" />
    </button>
  </div>
</div>;
```

**Step 4: Create chat page**

```tsx
"use client";

export default function ChatPage() {
  const { session, isLoading: authLoading } = useAuth();
  const { messages, isLoading, sendMessage, currentTool } = useAgentChat({
    accessToken: session?.access_token,
  });

  if (authLoading) return <LoadingSpinner />;
  if (!session) redirect("/login");

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <header className="sticky top-0 bg-surface/80 backdrop-blur border-b border-border p-4">
        <h1 className="text-lg font-semibold">AI Diagnostic</h1>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 pb-20 space-y-4">
        {messages.length === 0 && <WelcomeScreen />}
        {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
        {currentTool && <ToolIndicator tool={currentTool} />}
      </div>

      {/* Input */}
      <ChatInput onSend={sendMessage} isLoading={isLoading} />
    </div>
  );
}
```

**Step 5: Create (app) layout**

Minimal layout for authenticated pages — no Navbar (mobile PWA), just renders children.

**Step 6: Test end-to-end**

Start both servers:

```bash
# Terminal 1
deno task dev:diagnostic

# Terminal 2
cd apps/diagnostic-web && bun run dev
```

Navigate to `localhost:3001/chat`, log in, send a text message, verify streaming response.

**Step 7: Commit**

```bash
git commit -m "feat(diagnostic-web): add chat page with AG-UI streaming"
```

---

### Task 7: Camera Capture + Photo Upload

**Files:**

- Create: `apps/diagnostic-web/src/components/media/CameraCapture.tsx`
- Create: `apps/diagnostic-web/src/hooks/useCamera.ts`
- Modify: `apps/diagnostic-web/src/app/(app)/chat/page.tsx`

**Step 1: Create useCamera hook**

```typescript
export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const startCamera = async () => {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }, // Rear camera by default
    });
    setStream(mediaStream);
    if (videoRef.current) videoRef.current.srcObject = mediaStream;
  };

  const capturePhoto = (): string | null => {
    if (!videoRef.current) return null;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8); // base64
  };

  const stopCamera = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  };

  return { videoRef, stream, startCamera, capturePhoto, stopCamera };
}
```

**Step 2: Create CameraCapture component**

Full-screen camera overlay with:

- Live video preview
- Capture button (large, centered bottom)
- Close button (top-right)
- Flash toggle (if supported)
- Switch camera button (front/rear)

**Step 3: Wire camera into chat page**

When user taps camera button:

1. Open CameraCapture overlay
2. User takes photo
3. Convert to base64
4. Send to diagnostic-agent `/diagnostics/:id/input` as photo type
5. Display photo thumbnail in chat
6. Show AI analysis response

**Step 4: Test on mobile (or mobile emulator)**

Open DevTools → Toggle device toolbar → Test camera capture flow.

**Step 5: Commit**

```bash
git commit -m "feat(diagnostic-web): add camera capture for photo diagnosis"
```

---

## Phase 2: Payment Loop

### Task 8: Stripe Subscription Integration (Backend)

**Files:**

- Create: `apps/diagnostic-agent/src/routes/billing.ts`
- Modify: `apps/diagnostic-agent/src/main.ts` (mount billing routes)
- Modify: `apps/diagnostic-agent/src/lib/stripe.ts` (add subscription functions)

**Step 1: Add subscription helpers to stripe.ts**

```typescript
export async function createCheckoutSession(
  userId: string,
  email: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  // Find or create Stripe customer
  let stripeCustomerId = await getStripeCustomerIdForUser(userId);
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({ email, metadata: { userId } });
    stripeCustomerId = customer.id;
    // Update user_profiles
    await db.update(userProfiles)
      .set({ stripeCustomerId: customer.id })
      .where(eq(userProfiles.id, userId));
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{
      price: Deno.env.get("STRIPE_PLUS_PRICE_ID"), // $19.99/mo price
      quantity: 1,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session.url!;
}

export async function handleSubscriptionWebhook(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const active = sub.status === "active" || sub.status === "trialing";
      await db.update(userProfiles)
        .set({
          stripeSubscriptionId: sub.id,
          tier: active ? "plus" : "free",
        })
        .where(eq(userProfiles.stripeCustomerId, sub.customer as string));
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await db.update(userProfiles)
        .set({ stripeSubscriptionId: null, tier: "free" })
        .where(eq(userProfiles.stripeCustomerId, sub.customer as string));
      break;
    }
  }
}
```

**Step 2: Create billing routes**

```typescript
// POST /billing/checkout — create Stripe Checkout session
// POST /billing/webhook — handle Stripe webhooks
// GET  /billing/portal  — redirect to Stripe Customer Portal
```

**Step 3: Mount in main.ts**

```typescript
app.route("/billing", billing);
```

**Step 4: Create Stripe product + price in Stripe Dashboard**

- Product: "AutoDiag Plus"
- Price: $19.99/month recurring
- Save the price ID as `STRIPE_PLUS_PRICE_ID` env var

**Step 5: Test with Stripe CLI**

```bash
stripe listen --forward-to localhost:8001/billing/webhook
stripe trigger customer.subscription.created
```

**Step 6: Commit**

```bash
git commit -m "feat(diagnostic): add Stripe subscription billing routes"
```

---

### Task 9: Pricing Page + Upgrade Flow (Frontend)

**Files:**

- Create: `apps/diagnostic-web/src/app/pricing/page.tsx`
- Create: `apps/diagnostic-web/src/components/UpgradeModal.tsx`
- Modify: `apps/diagnostic-web/src/app/(app)/chat/page.tsx` (handle 403 upgrade_required)

**Step 1: Create pricing page**

Public page (no auth required) showing Free vs Plus comparison:

```tsx
export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-background p-6">
      <h1 className="text-3xl font-bold text-center mb-2">Simple Pricing</h1>
      <p className="text-text-secondary text-center mb-8">
        Try free, upgrade when you need more
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
        {/* Free Card */}
        <PricingCard
          name="Free"
          price="$0"
          features={[
            "3 text diagnoses/month",
            "1 vehicle",
            "Basic AI analysis",
          ]}
          cta="Get Started"
          href="/login"
        />

        {/* Plus Card */}
        <PricingCard
          name="Plus"
          price="$19.99"
          period="/month"
          features={[
            "Unlimited diagnoses",
            "Photo, audio, video, OBD",
            "Diagnostic reports (PDF)",
            "Unlimited vehicles",
            "Full diagnosis history",
          ]}
          cta="Start Plus"
          href="/api/billing/checkout"
          highlighted
        />
      </div>
    </div>
  );
}
```

**Step 2: Create UpgradeModal**

Modal that appears when Free user hits a limit (403 from backend):

- Shows what they tried to do
- Shows Plus benefits
- "Upgrade to Plus" button → redirects to Stripe Checkout
- "Maybe later" dismiss button

**Step 3: Handle 403 in chat page**

When agent returns `error: "upgrade_required"` or `error: "limit_reached"`:

- Show UpgradeModal
- Don't show error in chat

**Step 4: Test upgrade flow**

1. Sign up as new user (Free tier)
2. Send 3 text messages (should work)
3. Send 4th message → UpgradeModal appears
4. Click upgrade → Stripe Checkout
5. Complete payment (test card 4242...)
6. Webhook fires → tier updated to "plus"
7. Return to app → all features unlocked

**Step 5: Commit**

```bash
git commit -m "feat(diagnostic-web): add pricing page and upgrade flow"
```

---

## Phase 3: Product Polish

### Task 10: Audio Recording

**Files:**

- Create: `apps/diagnostic-web/src/hooks/useAudioRecorder.ts`
- Create: `apps/diagnostic-web/src/components/media/AudioRecorder.tsx`
- Modify: `apps/diagnostic-web/src/components/chat/ChatInput.tsx` (add mic button)

**Step 1: Create useAudioRecorder hook**

Uses `MediaRecorder API`:

- Start/stop recording
- Waveform visualization via `AnalyserNode`
- Duration tracking
- Output as webm blob → base64

**Step 2: Create AudioRecorder component**

Bottom sheet overlay:

- Large record button (red when recording)
- Waveform visualization
- Duration counter
- Stop → preview → send or discard

**Step 3: Wire into ChatInput**

Add mic button next to camera button. Tap → open AudioRecorder. On send → POST to
`/diagnostics/:id/input` as audio type.

**Step 4: Test**

Record engine sound, verify Whisper transcription + AI analysis.

**Step 5: Commit**

```bash
git commit -m "feat(diagnostic-web): add audio recording for sound diagnosis"
```

---

### Task 11: OBD Code Input

**Files:**

- Create: `apps/diagnostic-web/src/components/media/ObdInput.tsx`
- Modify: `apps/diagnostic-web/src/components/chat/ChatInput.tsx` (add OBD button)

**Step 1: Create ObdInput component**

Bottom sheet with:

- Text field for manual code entry (e.g., "P0171")
- Code format validation (P/B/C/U + 4 digits)
- "Add another code" to enter multiple
- Send all codes at once

**Step 2: Wire into ChatInput**

Add OBD icon button. Tap → open ObdInput sheet. On send → POST each code to `/diagnostics/:id/input`
as obd type.

**Step 3: Test**

Enter P0171, verify lookup + AI analysis.

**Step 4: Commit**

```bash
git commit -m "feat(diagnostic-web): add OBD code input"
```

---

### Task 12: Diagnostic Report PDF

**Files:**

- Create: `apps/diagnostic-agent/src/pdf/diagnostic-report.tsx`
- Create: `apps/diagnostic-agent/src/routes/reports.ts`
- Modify: `apps/diagnostic-agent/src/main.ts` (mount reports route)

**Step 1: Create React-PDF report template**

Reference `apps/api/src/pdf/` for patterns. Report includes:

- Header: date, vehicle info, session ID
- Summary: overall assessment with severity badge
- Issues found: list with severity, description, recommended action, estimated cost
- OBD codes: table with code, meaning, severity
- Media analyzed: thumbnails of photos submitted
- Disclaimer

**Step 2: Create report route**

```typescript
// GET /diagnostics/:id/report → generates and returns PDF
```

Reads `diagnostic_sessions.result` JSONB, renders React-PDF, returns PDF binary.

**Step 3: Add "Generate Report" button in frontend**

After diagnosis conversation, show "Download Report" button that fetches PDF.

**Step 4: Test**

Complete a diagnosis session, generate report, verify PDF content.

**Step 5: Commit**

```bash
git commit -m "feat(diagnostic): add diagnostic report PDF generation"
```

---

### Task 13: Diagnostic History Page

**Files:**

- Create: `apps/diagnostic-web/src/app/(app)/history/page.tsx`
- Create: `apps/diagnostic-web/src/components/BottomNav.tsx`

**Step 1: Create history page**

List of past diagnostic sessions:

- Card per session: date, vehicle, status, severity badge
- Tap → navigate to `/chat?session=<id>` to view conversation
- Empty state for new users

**Step 2: Create bottom navigation bar**

Fixed bottom nav (mobile pattern):

- Chat (message icon) — `/chat`
- History (clock icon) — `/history`
- Vehicles (car icon) — `/vehicles`
- Settings (gear icon) — `/settings`

Active state highlighting on current route.

**Step 3: Add bottom nav to (app) layout**

```tsx
export default function AppLayout({ children }) {
  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}
```

**Step 4: Commit**

```bash
git commit -m "feat(diagnostic-web): add history page and bottom navigation"
```

---

### Task 14: Vehicle Management Page

**Files:**

- Create: `apps/diagnostic-web/src/app/(app)/vehicles/page.tsx`
- Create: `apps/diagnostic-agent/src/routes/vehicles.ts`
- Modify: `apps/diagnostic-agent/src/main.ts` (mount vehicles route)

**Step 1: Create vehicles API routes**

```typescript
// GET    /vehicles          → list user's vehicles
// POST   /vehicles          → add vehicle { year, make, model, nickname }
// DELETE /vehicles/:id      → remove vehicle
```

**Step 2: Create vehicles page**

- List of vehicles with make/model/year and nickname
- "Add Vehicle" button → form with year, make, model, nickname fields
- Swipe to delete (mobile pattern)
- Free users: show limit (1 vehicle) and upgrade prompt

**Step 3: Connect vehicles to diagnostic sessions**

When starting a new chat, prompt user to select which vehicle they're asking about (if they have
multiple).

**Step 4: Commit**

```bash
git commit -m "feat(diagnostic): add vehicle management"
```

---

### Task 15: Settings Page

**Files:**

- Create: `apps/diagnostic-web/src/app/(app)/settings/page.tsx`

**Step 1: Create settings page**

Sections:

- **Account**: email, sign out button
- **Subscription**: current plan, upgrade/manage button (links to Stripe Portal)
- **Theme**: light/dark/system toggle
- **About**: version, privacy policy, terms links

**Step 2: Commit**

```bash
git commit -m "feat(diagnostic-web): add settings page"
```

---

## Phase 4: Growth (Future — Not in MVP)

These tasks are noted for future reference but NOT part of the current implementation:

- Task 16: Landing page with SEO content
- Task 17: Push notifications for diagnosis complete
- Task 18: Video diagnosis support
- Task 19: Business tier with team accounts
- Task 20: API access for third-party integrations

---

## Pre-Push Checklist

Before pushing any phase, run full CI:

```bash
# Web (diagnostic)
cd apps/diagnostic-web && bun run lint
cd apps/diagnostic-web && bun run typecheck
cd apps/diagnostic-web && bun run build

# Agent (diagnostic)
deno task check:diagnostic

# Existing apps (ensure no regressions)
cd apps/web && bun run lint && bun run typecheck && bun run build
deno task check:api
```
