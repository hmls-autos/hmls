# Diagnostic Image Upload via Supabase Storage

**Date**: 2026-02-22 **Status**: Approved

## Goal

Wire up photo capture and file picker in the diagnostic web app to actually upload images to
Supabase Storage, display thumbnails in chat, and replace the existing R2 storage backend.

## Current State

- **Backend**: `apps/diagnostic-agent/src/lib/r2.ts` uses `@aws-sdk/client-s3` to upload to
  Cloudflare R2. Used by `routes/input.ts` and `tools/storage.ts`.
- **Frontend**: `CameraCapture` component captures photos but `handlePhotoCapture` in
  `chat/page.tsx` has a TODO — the base64 data is discarded (`void base64`). No file picker exists.
- **R2 not enabled**: Cloudflare R2 isn't enabled on the account. Supabase is already fully
  configured.

## Design

### 1. Supabase Storage Bucket

Create a `diagnostic-media` **public** bucket. Public read means anyone with the URL can view (URLs
contain unguessable paths). Upload requires authentication via RLS.

**File path structure**: `{userId}/{sessionId}/{timestamp}-{filename}`

### 2. RLS Policies

- **Insert**: Authenticated users can upload to their own `{userId}/` prefix
- **Select**: Public (bucket is public)
- **Delete**: Owner only (match `auth.uid()` against the `{userId}` path prefix)

### 3. Backend: Replace R2 with Supabase Storage

**New file**: `apps/diagnostic-agent/src/lib/storage.ts`

```typescript
import { supabase } from "./supabase.ts";

const BUCKET = "diagnostic-media";

export interface UploadResult {
  key: string;
  url: string;
}

export async function uploadMedia(
  file: Uint8Array,
  filename: string,
  contentType: string,
  sessionId: string,
  userId: string,
): Promise<UploadResult> {
  const key = `${userId}/${sessionId}/${Date.now()}-${filename}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, file, { contentType, upsert: false });
  if (error) throw new Error(`[storage] Upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return { key, url: data.publicUrl };
}

export async function getMediaUrl(key: string): Promise<string> {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

export async function deleteMedia(key: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([key]);
  if (error) throw new Error(`[storage] Delete failed: ${error.message}`);
}
```

**Remove**: `apps/diagnostic-agent/src/lib/r2.ts`

**Update**: `apps/diagnostic-agent/src/routes/input.ts` — import from `lib/storage.ts`, pass
`userId` to `uploadMedia`

**Update**: `apps/diagnostic-agent/src/tools/storage.ts` — import from `lib/storage.ts` instead of
`lib/r2.ts`

**Update**: `apps/diagnostic-agent/src/env.ts` — remove `R2_*` env vars

**Update**: `apps/diagnostic-agent/deno.json` — remove `@aws-sdk/client-s3` dependency

### 4. Frontend: Wire Up Photo Upload

**`useAgentChat.ts`** — add `imageUrl` to `Message` interface:

```typescript
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
}
```

**`chat/page.tsx`** — fix `handlePhotoCapture`:

1. Create diagnostic session if needed (same pattern as `handleAudioSend`)
2. POST base64 to `/diagnostics/:id/input` with `type: "photo"`
3. Set `imageUrl` on the user message from the data URL (local preview)

**`chat/page.tsx`** — add `handleFilePick` for gallery uploads:

1. Hidden `<input type="file" accept="image/*">` triggered by a new button
2. Read file as base64, then same flow as photo capture

**`ChatInput.tsx`** — add file picker button (ImageIcon from lucide) next to camera button

**`MessageBubble.tsx`** — render image thumbnail:

```tsx
{
  message.imageUrl && (
    <img
      src={message.imageUrl}
      alt="Uploaded photo"
      className="rounded-lg max-w-full mt-1"
    />
  );
}
```

### 5. Cleanup

- Remove `@aws-sdk/client-s3` from `deno.json` imports
- Remove `R2_*` from `.env.example`
- Remove R2-related entries from `deno.lock`

## Files Changed

| File                                                        | Change                                      |
| ----------------------------------------------------------- | ------------------------------------------- |
| `apps/diagnostic-agent/src/lib/storage.ts`                  | **New** — Supabase Storage wrapper          |
| `apps/diagnostic-agent/src/lib/r2.ts`                       | **Delete**                                  |
| `apps/diagnostic-agent/src/routes/input.ts`                 | Update imports, pass userId                 |
| `apps/diagnostic-agent/src/tools/storage.ts`                | Update imports                              |
| `apps/diagnostic-agent/src/env.ts`                          | Remove R2_* vars                            |
| `apps/diagnostic-agent/deno.json`                           | Remove @aws-sdk/client-s3                   |
| `apps/diagnostic-web/src/hooks/useAgentChat.ts`             | Add imageUrl to Message                     |
| `apps/diagnostic-web/src/app/(app)/chat/page.tsx`           | Wire handlePhotoCapture, add handleFilePick |
| `apps/diagnostic-web/src/components/chat/ChatInput.tsx`     | Add file picker button                      |
| `apps/diagnostic-web/src/components/chat/MessageBubble.tsx` | Render image thumbnail                      |

## Acceptance Criteria

- [ ] `diagnostic-media` bucket exists in Supabase with public read
- [ ] RLS policies enforce upload-by-owner, public read, delete-by-owner
- [ ] Camera capture uploads photo to Supabase Storage and shows thumbnail in chat
- [ ] File picker allows selecting images from gallery and uploading
- [ ] R2 code and dependencies fully removed
- [ ] `deno check` passes for diagnostic agent
- [ ] `bun run typecheck` passes for diagnostic web
