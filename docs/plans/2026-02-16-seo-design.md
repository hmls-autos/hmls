# SEO Design — HMLS Web App

**Date:** 2026-02-16 **Domain:** hmls.autos **Approach:** Full Static SEO Pass (Approach B)

## Goals

- Rank in local searches ("mobile mechanic Orange County", "car repair near me")
- Look professional when links are shared on iMessage, Instagram, Facebook
- Zero ongoing maintenance — all generated at build time

## 1. Root Metadata

Expand `app/layout.tsx` metadata:

- `metadataBase`: `https://hmls.autos`
- `title.template`: `"%s | HMLS Mobile Mechanic"` (per-page titles auto-append brand)
- `title.default`: `"HMLS Mobile Mechanic - Orange County"`
- `description`: expanded with service keywords
- `keywords`: mobile mechanic, Orange County, auto repair, etc.
- `openGraph`: type website, locale en_US, siteName
- `twitter.card`: summary_large_image
- `robots`: index true, follow true

## 2. Per-Page Metadata

| Page       | Title              | Description                                                                                           |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `/`        | (uses default)     | (uses default)                                                                                        |
| `/contact` | "Contact"          | "Get in touch for reliable auto care. We come to you anywhere in Orange County. Call (949) 213-7073." |
| `/login`   | "Sign In"          | "Sign in to your HMLS Mobile Mechanic account to manage bookings and chat with our AI assistant."     |
| `/terms`   | "Terms of Service" | "Terms of service for HMLS Mobile Mechanic."                                                          |
| `/privacy` | "Privacy Policy"   | "Privacy policy for HMLS Mobile Mechanic."                                                            |

`/chat` excluded — behind auth, not indexed.

## 3. JSON-LD Structured Data

**AutoRepair** (homepage): schema.org `AutoRepair` subtype of `LocalBusiness`

- name, url, telephone, email
- areaServed: Orange County, California
- serviceType: Mobile Mechanic, Oil Change, Brake Repair, Diagnostics

**WebSite** (root layout): schema.org `WebSite` with name and url

Rendered via a reusable `<JsonLd data={...} />` component as `<script type="application/ld+json">`.

## 4. Sitemap

`app/sitemap.ts` — Next.js dynamic sitemap:

- `/` — priority 1.0, weekly
- `/contact` — priority 0.8, monthly
- `/terms` — priority 0.3, yearly
- `/privacy` — priority 0.3, yearly

## 5. Robots

`app/robots.ts`:

- Allow: /
- Disallow: /chat, /login, /auth/
- Sitemap: https://hmls.autos/sitemap.xml

## 6. Web Manifest

`app/manifest.ts`:

- name: "HMLS Mobile Mechanic"
- short_name: "HMLS"
- theme_color: #dc2626 (brand red)
- background_color: #ffffff

## 7. Favicon

`app/icon.tsx` — dynamic favicon via Next.js `ImageResponse`. Red "H" on white background.

## 8. OG Image

`app/opengraph-image.tsx` — 1200x630 dynamic image:

- Red-to-dark gradient background
- "HMLS" large bold text
- "Mobile Mechanic — Orange County" subtitle
- Serves as default for all pages

## Files

**Create (6):**

- `app/sitemap.ts`
- `app/robots.ts`
- `app/manifest.ts`
- `app/icon.tsx`
- `app/opengraph-image.tsx`
- `app/components/JsonLd.tsx`

**Modify (5):**

- `app/layout.tsx` — root metadata + WebSite JSON-LD
- `app/page.tsx` — AutoRepair JSON-LD
- `app/contact/page.tsx` — per-page metadata
- `app/login/page.tsx` — per-page metadata
- `app/terms/page.tsx` + `app/privacy/page.tsx` — per-page metadata

**Dependencies:** none — all Next.js built-in APIs
