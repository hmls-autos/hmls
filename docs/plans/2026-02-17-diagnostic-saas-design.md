# Diagnostic Agent SaaS Productization Design

**Date:** 2026-02-17 **Status:** Approved

## Overview

Productize the existing diagnostic-agent into an independent SaaS product — an AI-powered vehicle
diagnostic assistant accessible via a mobile-first PWA.

## Product Direction

- **Type:** Independent SaaS (separate brand/domain, shared infrastructure)
- **Target Users:** C-end (car owners) + B-end (mechanics/shops) — MVP focuses on C-end
- **Business Model:** Freemium — Free trial + paid subscription
- **Frontend:** PWA, mobile-first (camera/mic access from phone)

## Pricing

|                          | Free                     | Plus ($19.99/mo)         |
| ------------------------ | ------------------------ | ------------------------ |
| Target                   | Car owners trying it out | Regular users, mechanics |
| Text diagnosis           | 3/month                  | Unlimited                |
| Photo/Audio/Video/OBD    | None                     | Unlimited                |
| Diagnostic reports (PDF) | None                     | Unlimited                |
| Diagnostic history       | Not saved                | Unlimited                |
| Vehicle management       | 1 vehicle                | Unlimited                |

**Cost analysis:**

- Per-diagnosis API cost: ~$0.30-0.80 (Claude + Whisper + Vision + R2)
- Free user max cost: ~$0.15 (3 text-only queries)
- Plus user at 30 diagnoses/month: ~$15 cost → $19.99 revenue → ~25% margin
- Plus user at 10 diagnoses/month: ~$5 cost → $19.99 revenue → ~75% margin
- Breakeven: 2.5% free-to-paid conversion rate

**Business tier deferred** to post-MVP (team accounts, branded reports, API access).

## Architecture — Monorepo Extension

```
apps/
├── web/                  # HMLS main site (existing)
├── diagnostic-web/       # NEW: PWA frontend, independent domain
├── diagnostic-agent/     # Existing backend, enhanced for SaaS
├── api/                  # HMLS main API (existing)
packages/
└── shared/               # @hmls/shared (existing, reused)
```

Rationale: Reuse Supabase auth, Stripe, Drizzle, @hmls/shared. Fastest path to MVP. Deploy to
separate domain — appears fully independent to users.

## Frontend Architecture

### Tech Stack

- Next.js (App Router) in `apps/diagnostic-web/`
- React 19, Tailwind CSS 4 (same as apps/web)
- PWA: manifest.json + Service Worker
- AG-UI client for streaming chat

### File Structure

```
apps/diagnostic-web/
├── public/
│   ├── manifest.json         # PWA manifest
│   └── sw.js                 # Service Worker (App Shell caching)
├── src/
│   ├── app/
│   │   ├── (auth)/           # Login / Sign up (Supabase Auth)
│   │   ├── (app)/
│   │   │   ├── chat/         # Main diagnostic chat interface
│   │   │   ├── history/      # Past diagnostic sessions
│   │   │   ├── vehicles/     # Vehicle management (year/make/model)
│   │   │   └── settings/     # Account & subscription management
│   │   └── pricing/          # Public pricing page
│   ├── components/
│   │   ├── chat/             # Chat UI components
│   │   ├── media/            # Camera, audio recorder, upload
│   │   └── diagnosis/        # Results, severity badges, reports
│   └── lib/
│       ├── ag-ui.ts          # AG-UI streaming client
│       └── supabase.ts       # Supabase Auth client
```

### Core Pages

1. **Chat** (`/chat`) — Main interface. ChatGPT-style with bottom toolbar: camera / mic / text / OBD
2. **Pricing** (`/pricing`) — Landing page with Free vs Plus comparison
3. **History** (`/history`) — Past diagnostic session list
4. **Vehicles** (`/vehicles`) — Manage vehicles (year/make/model/nickname)

### Mobile-First Interactions

- Bottom toolbar: Camera / Mic / Keyboard / OBD buttons
- Direct `getUserMedia` for camera (no file picker)
- `MediaRecorder API` for audio with live waveform
- One-tap share diagnostic report links

### PWA Capabilities

- App Shell offline caching strategy
- Add to Home Screen prompt
- Push notifications (diagnosis complete)

## Backend Changes

### What Changes

**1. Subscription System (New)**

- Stripe Checkout → create subscription
- Webhooks: `customer.subscription.created/updated/deleted`
- Middleware: Free user → check quota; Plus user → pass through

**2. Free Tier Quota Check**

- No separate usage_tracking table needed
- Query existing `diagnostic_media` table: count by user_id + type + current month
- Stripe handles all billing state for Plus users

**3. Diagnostic Report Generation (New)**

- Reuse React-PDF pattern from `apps/api/src/pdf/`
- AI generates structured JSON diagnosis at session end
- Store in `diagnostic_sessions.result` (existing JSONB column)
- Render to PDF on demand, store in R2

**4. Auth Overhaul**

- Current: looks up `customers` table
- New: independent `user_profiles` table linked to `auth.users`
- Registration → Supabase Auth → auto-create `user_profiles` row
- Login → JWT → middleware queries `user_profiles` → determines tier

### What Stays the Same

- Agent core (tools, skills, system-prompt) — untouched
- R2 storage — untouched
- AG-UI protocol — untouched
- Whisper / Vision API calls — untouched

## Database Schema Changes

```sql
-- New: user profiles (extends Supabase auth.users)
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- New: vehicles
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  year INT,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  vin TEXT,
  nickname TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Modify: diagnostic_sessions — add user_id and vehicle_id
ALTER TABLE diagnostic_sessions
  ADD COLUMN user_id UUID REFERENCES user_profiles(id),
  ADD COLUMN vehicle_id UUID REFERENCES vehicles(id);
```

### Middleware Logic

```
Request → JWT from Supabase Auth
  → Query user_profiles
    → Has stripe_subscription_id?
      → Yes: Check Stripe status (cached) → active → allow
      → No: Count this month's usage from diagnostic_media
        → Under limit → allow
        → Over limit → return upgrade prompt
```

## Deployment

```
diagnose.hmls.com (or independent domain)
       │
       ▼
  Deno Deploy ← apps/diagnostic-web (Next.js PWA)
       │
       ▼
  Deno Deploy ← apps/diagnostic-agent (Hono API)
       │
       ├── Supabase (Auth + PostgreSQL)
       ├── Cloudflare R2 (media storage)
       ├── Stripe (subscription billing)
       ├── Anthropic (Claude Vision / Sonnet)
       └── OpenAI (Whisper speech-to-text)
```

## Implementation Phases

### Phase 1 — Core MVP (2-3 weeks)

1. Create `apps/diagnostic-web` PWA scaffold
2. Login / Sign up (Supabase Auth)
3. Diagnostic chat page (AG-UI streaming)
4. Photo capture + text input
5. `user_profiles` + `vehicles` DB migration
6. Free user quota check middleware

### Phase 2 — Payment Loop (1-2 weeks)

7. Pricing page
8. Stripe Checkout subscription integration
9. Webhook handler for subscription lifecycle
10. Plus user permission pass-through

### Phase 3 — Product Polish (1-2 weeks)

11. Audio recording + upload
12. OBD code input
13. Diagnostic report PDF generation
14. Diagnostic history page
15. Vehicle management page

### Phase 4 — Growth (later)

16. Landing page / SEO
17. Push notifications
18. Video diagnosis
19. Business tier
