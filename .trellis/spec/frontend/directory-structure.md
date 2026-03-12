# Directory Structure

> How frontend code is organized in this project.

---

## Overview

The web app uses **Next.js App Router** with a flat, non-nested layout. There is **no `src/`
directory** — all code lives directly under `apps/web/`. The `@/*` path alias maps to `apps/web/*`.

---

## Directory Layout

```
apps/web/
├── app/                        # Next.js App Router pages & routes
│   ├── layout.tsx              # Root layout (AuthProvider, ThemeProvider, Navbar)
│   ├── page.tsx                # Landing page (composes section components)
│   ├── template.tsx            # Page transition wrapper
│   ├── error.tsx               # Global error boundary
│   ├── not-found.tsx           # 404 page
│   ├── loading.tsx             # Global loading state
│   ├── globals.css             # Tailwind v4 config + theme tokens
│   ├── auth/
│   │   ├── callback/route.ts   # OAuth callback handler
│   │   └── confirm/route.ts    # Email confirmation handler
│   ├── chat/page.tsx           # Chat page
│   ├── contact/page.tsx        # Contact page
│   ├── login/
│   │   ├── page.tsx            # Login form
│   │   └── layout.tsx          # Login layout with metadata
│   ├── privacy/page.tsx
│   ├── terms/page.tsx
│   ├── sitemap.ts              # Dynamic sitemap generation
│   ├── robots.ts               # Dynamic robots.txt
│   ├── manifest.ts             # PWA manifest
│   ├── icon.tsx                # Dynamic favicon
│   └── opengraph-image.tsx     # Dynamic OG image
├── components/                 # All React components (flat structure)
│   ├── sections/               # Landing page section components
│   │   ├── HeroNew.tsx
│   │   ├── ServicesNew.tsx
│   │   ├── HowItWorks.tsx
│   │   ├── ServiceAreaNew.tsx
│   │   └── ...
│   ├── ui/                     # Reusable UI primitives
│   │   ├── Animations.tsx      # FadeIn, ScaleIn, StaggerContainer
│   │   ├── Markdown.tsx
│   │   ├── ServiceCard.tsx
│   │   ├── RevealOnScroll.tsx
│   │   └── RealMap.tsx
│   ├── AuthProvider.tsx        # Auth context + useAuth hook
│   ├── ChatWidget.tsx          # Floating chat widget
│   ├── ChatWidgetPanel.tsx     # Chat panel content
│   ├── Navbar.tsx
│   ├── MobileNav.tsx
│   ├── FooterNew.tsx
│   ├── ThemeToggle.tsx
│   ├── QuestionCard.tsx
│   └── JsonLd.tsx
├── hooks/                      # Custom React hooks
│   ├── useAgentChat.ts
│   ├── useCustomer.ts
│   └── useEstimate.ts
├── lib/                        # Utility modules and service clients
│   ├── supabase/
│   │   ├── client.ts           # Browser Supabase client
│   │   ├── server.ts           # Server Supabase client
│   │   └── middleware.ts       # Supabase middleware helpers
│   ├── agent-tools.ts
│   ├── fetcher.ts              # SWR fetcher with auth injection
│   └── image-loader.ts
└── proxy.ts                    # Middleware (Supabase session refresh)
```

---

## Module Organization

- **No `types/` directory** — types are co-located inline with their consumers
- **No `utils/` directory** — utilities live under `lib/`
- **No barrel files (`index.ts`)** — components are imported by full file path
- **No test files** — no test runner configured

---

## Naming Conventions

| Item               | Convention                           | Example                             |
| ------------------ | ------------------------------------ | ----------------------------------- |
| Components         | `PascalCase.tsx`                     | `ChatWidget.tsx`, `ServiceCard.tsx` |
| Hooks              | `useCamelCase.ts`                    | `useAgentChat.ts`, `useCustomer.ts` |
| Utilities          | `camelCase.ts`                       | `fetcher.ts`, `image-loader.ts`     |
| Pages              | `page.tsx` (Next.js convention)      | `app/chat/page.tsx`                 |
| Layouts            | `layout.tsx`                         | `app/login/layout.tsx`              |
| Section components | `components/sections/PascalCase.tsx` | `HeroNew.tsx`                       |
| UI primitives      | `components/ui/PascalCase.tsx`       | `RevealOnScroll.tsx`                |

---

## Examples

- **Landing page composition**: `apps/web/app/page.tsx` — server component composing sections
- **Reusable UI component**: `apps/web/components/ui/ServiceCard.tsx`
- **Data fetching hook**: `apps/web/hooks/useCustomer.ts`
- **Auth context**: `apps/web/components/AuthProvider.tsx`
