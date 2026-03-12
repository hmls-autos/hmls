# Frontend Facelift — Strip Animation Libraries + Visual Refresh

## Goal

Strip ~155KB of JS animation libraries (GSAP, Three.js, Lenis) from the homepage, replace with
performant CSS-only animations, and give all homepage sections a premium visual refresh.

## Requirements

### Phase 1: Strip Animation Bloat

- Remove GSAP/ScrollTrigger from all 7 homepage sections + SmoothScroll
- Remove Lenis smooth scroll library
- Remove Three.js/React Three Fiber (FluidBackground, BackgroundWrapper)
- Remove @gsap/react bindings
- Remove 9 deps from package.json: gsap, @gsap/react, lenis, three, @types/three,
  @react-three/fiber, @react-three/drei, @react-three/postprocessing, postprocessing
- Keep framer-motion ONLY for interactive client components (Chat*, Booking*, SlotPicker,
  QuestionCard, login, chat, not-found, loading, error pages)
- Rewrite components/ui/Animations.tsx to use CSS instead of framer-motion
- Replace all GSAP animations with CSS @keyframes + IntersectionObserver (existing RevealOnScroll +
  .reveal classes)
- Add CSS animation utilities: fade-up, fade-in, slide-in-left, slide-in-right
- Wrap all animations in prefers-reduced-motion: no-preference

### Phase 2: Visual Facelift

- Premium automotive brand feel — dark theme, red (#cc2222) accent
- Hero: full-viewport, single gradient overlay, clean headline + CTA
- TrustBar: clean stat counter row, static numbers
- HowItWorks: 3-step horizontal cards, stagger reveal via CSS transition-delay
- Services: clean grid cards (2-3 columns), CSS hover effects
- About: photo + text side-by-side, no parallax
- ServiceArea: keep Leaflet map, simplify chrome
- CTA: full-width dark section, red CTA button
- Footer: light cleanup only
- Navbar: keep as-is (already good)

### Phase 3: Cleanup & Verify

- Delete: SmoothScroll.tsx, Background.tsx, FluidBackground.tsx, BackgroundWrapper.tsx
- Remove BackgroundWrapper from layout.tsx
- Run bun install after package.json changes
- Pass: lint, typecheck, build

## Acceptance Criteria

- [ ] Zero GSAP/Three.js/Lenis imports remain
- [ ] package.json has no animation library deps (except framer-motion)
- [ ] All homepage sections use CSS animations via RevealOnScroll
- [ ] prefers-reduced-motion respected
- [ ] Visual refresh applied to all sections
- [ ] bun run lint passes
- [ ] bun run typecheck passes
- [ ] bun run build passes
- [ ] No new npm dependencies added
- [ ] Chat components unchanged (framer-motion kept)

## Technical Notes

- Existing RevealOnScroll component + .reveal CSS classes already built
- globals.css already has prefers-reduced-motion media query
- Need to add slide-in-left, slide-in-right, scale-in keyframes to globals.css
- ServiceArea must keep "use client" for dynamic Leaflet import
- TrustBar counter can use static numbers (no JS counter animation needed)
- template.tsx page-enter animation is already CSS-based, keep it
