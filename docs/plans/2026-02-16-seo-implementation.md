# SEO Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Add comprehensive SEO to hmls.autos — local search ranking + social sharing

**Architecture:** All Next.js built-in APIs (Metadata, sitemap, robots, ImageResponse). No external
deps. JsonLd component for structured data. Per-page metadata via exports or sub-layouts.

**Tech Stack:** Next.js 16 Metadata API, ImageResponse (from `next/og`)

---

### Task 1: JsonLd Component

**Files:**

- Create: `apps/web/components/JsonLd.tsx`

**Step 1: Create the component**

```tsx
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
```

**Step 2: Verify lint passes**

Run: `cd apps/web && bun run lint` Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/components/JsonLd.tsx
git commit -m "feat(web): add JsonLd component for structured data"
```

---

### Task 2: Root Metadata + WebSite Schema

**Files:**

- Modify: `apps/web/app/layout.tsx:1-25` (metadata export)

**Step 1: Expand the metadata export**

Replace lines 21-25 of `apps/web/app/layout.tsx` with:

```tsx
export const metadata: Metadata = {
  metadataBase: new URL("https://hmls.autos"),
  title: {
    default: "HMLS Mobile Mechanic - Orange County",
    template: "%s | HMLS Mobile Mechanic",
  },
  description:
    "Expert mobile mechanic service in Orange County. We come to you for oil changes, brake repair, diagnostics & more.",
  keywords: [
    "mobile mechanic",
    "Orange County",
    "auto repair",
    "car mechanic near me",
    "mobile car repair",
    "mobile mechanic Orange County",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "HMLS Mobile Mechanic",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
};
```

**Step 2: Add WebSite JSON-LD to the body**

Import `JsonLd` at the top of `layout.tsx`:

```tsx
import { JsonLd } from "@/components/JsonLd";
```

Add inside `<body>`, before `<ThemeProvider>`:

```tsx
<JsonLd
  data={{
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "HMLS Mobile Mechanic",
    url: "https://hmls.autos",
  }}
/>;
```

**Step 3: Verify lint + typecheck**

Run: `cd apps/web && bun run lint && bun run typecheck` Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/app/layout.tsx
git commit -m "feat(web): add root SEO metadata and WebSite schema"
```

---

### Task 3: Homepage AutoRepair Schema

**Files:**

- Modify: `apps/web/app/page.tsx`

**Step 1: Add AutoRepair JSON-LD to homepage**

Import `JsonLd` and add it as the first child inside `<main>`:

```tsx
import { JsonLd } from "@/components/JsonLd";
```

```tsx
<main className="min-h-full bg-background text-text">
  <JsonLd
    data={{
      "@context": "https://schema.org",
      "@type": "AutoRepair",
      name: "HMLS Mobile Mechanic",
      url: "https://hmls.autos",
      telephone: "+19492137073",
      email: "business@hmls.autos",
      areaServed: {
        "@type": "City",
        name: "Orange County",
        containedInPlace: {
          "@type": "State",
          name: "California",
        },
      },
      serviceType: [
        "Mobile Mechanic",
        "Oil Change",
        "Brake Repair",
        "Diagnostics",
      ],
      description:
        "Expert mobile mechanic service in Orange County. We come to you.",
    }}
  />
  <HeroNew />
  ...
```

**Step 2: Verify lint**

Run: `cd apps/web && bun run lint` Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(web): add AutoRepair structured data to homepage"
```

---

### Task 4: Per-Page Metadata (contact, terms, privacy)

**Files:**

- Modify: `apps/web/app/contact/page.tsx:1-6`
- Modify: `apps/web/app/terms/page.tsx:1-4`
- Modify: `apps/web/app/privacy/page.tsx:1-4`

**Step 1: Add metadata to contact page**

Add at the top of `apps/web/app/contact/page.tsx`, after imports:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch for reliable auto care. We come to you anywhere in Orange County. Call (949) 213-7073.",
};
```

**Step 2: Add metadata to terms page**

Add at the top of `apps/web/app/terms/page.tsx`, after imports:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of service for HMLS Mobile Mechanic.",
};
```

**Step 3: Add metadata to privacy page**

Add at the top of `apps/web/app/privacy/page.tsx`, after imports:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for HMLS Mobile Mechanic.",
};
```

**Step 4: Verify lint + typecheck**

Run: `cd apps/web && bun run lint && bun run typecheck` Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/app/contact/page.tsx apps/web/app/terms/page.tsx apps/web/app/privacy/page.tsx
git commit -m "feat(web): add per-page SEO metadata for contact, terms, privacy"
```

---

### Task 5: Login Page Metadata (via sub-layout)

**Files:**

- Create: `apps/web/app/login/layout.tsx`

**Step 1: Create login sub-layout with metadata**

The login `page.tsx` is `"use client"` so metadata must come from a layout:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description:
    "Sign in to your HMLS Mobile Mechanic account to manage bookings and chat with our AI assistant.",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
```

**Step 2: Verify lint + typecheck**

Run: `cd apps/web && bun run lint && bun run typecheck` Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/app/login/layout.tsx
git commit -m "feat(web): add login page metadata via sub-layout"
```

---

### Task 6: Sitemap

**Files:**

- Create: `apps/web/app/sitemap.ts`

**Step 1: Create dynamic sitemap**

```ts
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://hmls.autos";

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/contact`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
```

**Step 2: Verify lint**

Run: `cd apps/web && bun run lint` Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/app/sitemap.ts
git commit -m "feat(web): add dynamic sitemap.xml"
```

---

### Task 7: Robots

**Files:**

- Create: `apps/web/app/robots.ts`

**Step 1: Create robots config**

```ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/chat", "/login", "/auth/"],
    },
    sitemap: "https://hmls.autos/sitemap.xml",
  };
}
```

**Step 2: Verify lint**

Run: `cd apps/web && bun run lint` Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/app/robots.ts
git commit -m "feat(web): add robots.txt config"
```

---

### Task 8: Web Manifest

**Files:**

- Create: `apps/web/app/manifest.ts`

**Step 1: Create manifest**

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HMLS Mobile Mechanic",
    short_name: "HMLS",
    description: "Expert mobile mechanic service in Orange County. We come to you.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#dc2626",
  };
}
```

**Step 2: Verify lint**

Run: `cd apps/web && bun run lint` Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/app/manifest.ts
git commit -m "feat(web): add web app manifest"
```

---

### Task 9: Dynamic Favicon

**Files:**

- Create: `apps/web/app/icon.tsx`

**Step 1: Create dynamic favicon**

Uses Next.js `ImageResponse` to generate a favicon at build time. Red "H" on white background:

```tsx
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          borderRadius: "6px",
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "#dc2626",
          }}
        >
          H
        </span>
      </div>
    ),
    { ...size },
  );
}
```

**Step 2: Verify lint + build**

Run: `cd apps/web && bun run lint && bun run build` Expected: PASS — favicon should appear in build
output

**Step 3: Commit**

```bash
git add apps/web/app/icon.tsx
git commit -m "feat(web): add dynamic favicon"
```

---

### Task 10: Dynamic OG Image

**Files:**

- Create: `apps/web/app/opengraph-image.tsx`

**Step 1: Create OG image**

1200x630 branded image with red-to-dark gradient:

```tsx
import { ImageResponse } from "next/og";

export const alt = "HMLS Mobile Mechanic - Orange County";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #dc2626 0%, #1a1a1a 100%)",
        }}
      >
        <span
          style={{
            fontSize: 80,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: "-0.02em",
          }}
        >
          HMLS
        </span>
        <span
          style={{
            fontSize: 32,
            fontWeight: 400,
            color: "rgba(255,255,255,0.85)",
            marginTop: 12,
          }}
        >
          Mobile Mechanic — Orange County
        </span>
      </div>
    ),
    { ...size },
  );
}
```

**Step 2: Verify lint + build**

Run: `cd apps/web && bun run lint && bun run build` Expected: PASS — OG image route should appear in
build output

**Step 3: Commit**

```bash
git add apps/web/app/opengraph-image.tsx
git commit -m "feat(web): add dynamic Open Graph image"
```

---

### Task 11: Final Verification

**Step 1: Run full CI suite**

```bash
cd apps/web && bun run lint
cd apps/web && bun run typecheck
cd apps/web && bun run build
```

Expected: All PASS. Build output should show new routes:

- `/sitemap.xml`
- `/robots.txt`
- `/manifest.webmanifest`
- `/icon` (favicon)
- `/opengraph-image` (OG image)

**Step 2: Verify build output includes SEO routes**

Check the build output table for the new static routes.

**Step 3: Final commit if any fixes needed**

Only if previous steps required adjustments.
