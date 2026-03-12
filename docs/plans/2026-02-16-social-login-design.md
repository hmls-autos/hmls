# Social Login Design

## Summary

Add social login (OAuth) support to the HMLS web app using Supabase Auth's built-in OAuth providers.
Social login buttons appear above the existing email/password form. A Postgres trigger auto-syncs
new auth users to the `customers` table by matching email or creating a new record.

## Decisions

- **Providers**: Google, Apple, Facebook, GitHub, Discord, Twitter/X
- **Customer sync**: DB trigger on `auth.users` INSERT — match by email first, auto-create if not
  found
- **Login UI**: Social buttons above existing email/password form with divider
- **Platform**: Web only (no native app requirements)
- **Approach**: Supabase-native OAuth (Approach A — DB trigger sync)
- **Production URL**: `https://hmls.autos`

## Current State

- Supabase Auth with email/password only
- Login page at `apps/web/app/login/page.tsx`
- AuthProvider with `useAuth()` hook at `apps/web/components/AuthProvider.tsx`
- Email confirmation callback at `apps/web/app/auth/confirm/route.ts`
- No OAuth callback route
- `customers` table in Supabase DB (no `auth_user_id` column)
- Supabase Site URL still set to `http://localhost:3000` (needs fixing)

## Architecture

### Auth Flow

```
User clicks "Sign in with Google"
  -> supabase.auth.signInWithOAuth({ provider: 'google' })
  -> Redirect to provider consent screen
  -> Redirect back to /auth/callback
  -> Supabase exchanges code for session
  -> DB trigger fires: match customers by email or create new
  -> AuthProvider picks up session, redirects to /chat
```

### DB Trigger

A Supabase migration that:

1. Adds `auth_user_id UUID UNIQUE` column to `customers` table
2. Creates function `handle_new_user()`:
   - Extracts email, name from `auth.users` + `raw_user_meta_data`
   - Looks up `customers` by email
   - If found: sets `auth_user_id` on existing row
   - If not found: inserts new `customers` row with name, email, auth_user_id
3. Creates trigger on `auth.users` AFTER INSERT that calls `handle_new_user()`

### Login Page UI

```
+-------------------------------+
|       Welcome back            |
|  Sign in to access your       |
|         account               |
|                               |
|  [G] Continue with Google     |
|  [] Continue with Apple      |
|  [f] Continue with Facebook   |
|  [  ] Continue with GitHub    |
|  [  ] Continue with Discord   |
|  [  ] Continue with Twitter   |
|                               |
|  -------- or --------         |
|                               |
|  Email: [____________]        |
|  Password: [_________]        |
|  [Sign In]                    |
|                               |
|  Don't have an account?       |
|  Sign up                      |
+-------------------------------+
```

## Changes Required

### Supabase Dashboard (manual)

1. **URL Configuration**: Set Site URL to `https://hmls.autos`, add redirect URLs
2. **Auth Providers**: Enable Google, Apple, Facebook, GitHub, Discord, Twitter/X with client
   IDs/secrets from each provider's developer console

### Supabase Migration (SQL)

- Add `auth_user_id` column to `customers`
- Create `handle_new_user()` function + trigger

### New Files

- `apps/web/app/auth/callback/route.ts` — OAuth callback handler (exchanges code for session via
  PKCE)

### Modified Files

- `apps/web/app/login/page.tsx` — Add social login buttons above email form with divider

### Environment Variables (per provider)

Each provider needs its client ID and secret configured in the Supabase dashboard. No new env vars
needed in the app code — Supabase handles the OAuth flow server-side.
