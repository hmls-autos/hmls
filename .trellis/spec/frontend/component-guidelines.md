# Component Guidelines

> Component patterns, props conventions, and composition patterns.

---

## Overview

Components use **React 19** with **Next.js App Router**. Server components are the default; client
components explicitly declare `"use client"`. Props are defined as inline interfaces, never in
separate type files.

---

## Export Patterns

### Default Exports — Standalone/Page Components

```typescript
// apps/web/components/Navbar.tsx
export default function Navbar() { ... }

// apps/web/app/page.tsx
export default function Home() { ... }
```

### Named Exports — Co-located with Related Exports

```typescript
// apps/web/components/AuthProvider.tsx — exports both component and hook
export function useAuth() { ... }
export function AuthProvider({ children }: { children: React.ReactNode }) { ... }

// apps/web/components/ui/Animations.tsx — exports multiple components
export function FadeIn() { ... }
export function ScaleIn() { ... }
export function StaggerContainer() { ... }
```

---

## Props Conventions

Define props as **inline `interface`** directly above the component:

```typescript
// apps/web/components/ui/ServiceCard.tsx
interface ServiceCardProps {
  title: string;
  description: string;
  price: string;
  href?: string;
}

export default function ServiceCard({ title, description, price, href }: ServiceCardProps) { ... }
```

### Layout/Wrapper Components

Use inline `{ children: React.ReactNode }`:

```typescript
// apps/web/app/template.tsx
export default function Template({ children }: { children: React.ReactNode }) { ... }
```

---

## Server vs Client Components

### Server Components (default — no directive)

Used for static rendering, SEO content, landing page sections:

```typescript
// apps/web/components/sections/HeroNew.tsx — no "use client"
export default function HeroNew() { ... }
```

### Client Components (`"use client"` at line 1)

Required for interactivity, hooks, browser APIs, Framer Motion:

```typescript
// apps/web/components/ChatWidget.tsx
"use client";

export function ChatWidget() { ... }
```

---

## Composition Patterns

### Section Composition (Landing Page)

Server component composing multiple section components:

```typescript
// apps/web/app/page.tsx
export default function Home() {
  return (
    <main className="bg-background text-text">
      <JsonLd data={{...}} />
      <HeroNew />
      <TrustBar />
      <HowItWorks />
      <ServicesNew />
      <AboutNew />
      <ServiceAreaNew />
      <CTANew />
      <FooterNew />
    </main>
  );
}
```

### Dynamic Imports for Heavy Components

Use `next/dynamic` for SSR-incompatible or heavy components:

```typescript
// apps/web/components/ChatWidget.tsx
const ChatWidgetPanel = dynamic(() => import("./ChatWidgetPanel"), {
  ssr: false,
});

// apps/web/components/sections/ServiceAreaNew.tsx
const ServiceMap = dynamic(() => import("@/components/ui/RealMap"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-surface-alt animate-pulse rounded-xl" />,
});
```

---

## Forbidden Patterns

- Do not create barrel files (`index.ts`) — import components by full file path
- Do not create a separate `types/` directory — co-locate types with consumers
- Do not use Framer Motion in server components — use CSS-based `RevealOnScroll` instead
- Do not omit `"use client"` on components that use hooks or browser APIs
