# Quality Guidelines

> Code standards, linting, accessibility, and styling conventions.

---

## Overview

The web app uses **Biome** for linting/formatting, **Tailwind CSS v4** with semantic design tokens,
and has strong accessibility conventions.

---

## Biome Configuration

Configured at `apps/web/biome.json`:

| Setting             | Value              |
| ------------------- | ------------------ |
| Indent              | `space`, width `2` |
| Quotes              | `double`           |
| Linter rules        | `recommended`      |
| Import organization | Auto-organized     |

```bash
cd apps/web && bun run lint       # Run Biome
cd apps/web && bun run typecheck  # TypeScript check
cd apps/web && bun run build      # Next.js build
```

### Biome Ignore Comments

When suppression is needed, always include an explanation:

```typescript
// biome-ignore lint/suspicious/noShadowRestrictedNames: Next.js requires this name
// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires inline script injection
// biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on messages change
```

---

## Styling Conventions

### Tailwind CSS v4 with Semantic Tokens

All colors reference semantic tokens defined in `apps/web/app/globals.css`, not raw Tailwind
classes:

```css
/* globals.css — theme tokens */
--color-background: ...;
--color-text: ...;
--color-red-primary: ...;
--color-surface-alt: ...;
--color-border: ...;
```

```tsx
{/* CORRECT */}
<div className="bg-background text-text border-border" />
<button className="bg-red-primary text-white" />

{/* WRONG — do not use raw colors */}
<div className="bg-gray-900 text-white border-gray-700" />
```

### Icons

Use **lucide-react** exclusively. No other icon library.

---

## Accessibility

### Required on All Interactive Elements

1. **`aria-label` on icon-only buttons**:
   ```tsx
   <button aria-label={isOpen ? "Close chat" : "Open chat"}>
     <MessageCircle />
   </button>;
   ```

2. **`type="button"` on non-submit buttons**:
   ```tsx
   <button type="button" onClick={toggle}>...</button>;
   ```

3. **`focus-visible:ring-2 focus-visible:ring-red-primary`** on interactive elements:
   ```tsx
   <a className="focus-visible:ring-2 focus-visible:ring-red-primary rounded-lg">
   ```

4. **`aria-hidden="true"` on decorative icons**:
   ```tsx
   <RefreshCw size={20} aria-hidden="true" />;
   ```

### Screen Reader Support

```tsx
{/* Skip-to-content link in root layout */}
<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a>;

{/* SR-only labels for inputs */}
<label htmlFor="chat-input" className="sr-only">Chat message</label>;
```

### Semantic HTML

- `<main>` wrapper on every page
- `<section>` with `id` for content sections
- `<nav>` with `aria-label` for navigation
- `<header>` for the navbar, `<footer>` for the footer
- `role="menu"` and `role="menuitem"` for dropdown menus
- `aria-expanded` and `aria-haspopup` on toggle buttons

### Reduced Motion

Respected in three ways:

1. **CSS**: `prefers-reduced-motion` media query disables animations in `globals.css`
2. **JavaScript**: `matchMedia` check in `RevealOnScroll`
3. **Framer Motion**: `useReducedMotion()` hook in interactive pages

---

## Animation Systems

| System                                    | Use Case                      | Where                      |
| ----------------------------------------- | ----------------------------- | -------------------------- |
| CSS `reveal` class + IntersectionObserver | Landing page scroll reveals   | `RevealOnScroll` component |
| Framer Motion                             | Interactive client components | Chat, error, login pages   |

Prefer CSS animations for server-rendered sections; Framer Motion for client components.

---

## SEO

### Page Metadata

Export `Metadata` on server-rendered pages:

```typescript
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page Title",
  description: "Page description",
};
```

### JSON-LD

Use the `JsonLd` component for structured data:

```tsx
<JsonLd data={{ "@context": "https://schema.org", "@type": "AutoRepair", ... }} />
```

### Dynamic SEO Files

Generate `sitemap.ts`, `robots.ts`, and `manifest.ts` as TypeScript files in `app/`.

---

## Forbidden Patterns

- Do not use raw Tailwind color classes — always use semantic tokens (`bg-red-primary`, not
  `bg-red-600`)
- Do not use `autoFocus` attribute — use `useEffect` with device detection instead
- Do not omit `type="button"` on non-submit buttons
- Do not omit `aria-label` on icon-only buttons
- Do not forget `focus-visible:ring-2 focus-visible:ring-red-primary` on interactive elements
- Do not suppress Biome rules without an explanation comment
