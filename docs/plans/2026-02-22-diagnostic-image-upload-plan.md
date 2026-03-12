# Diagnostic Image Upload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Replace Cloudflare R2 with Supabase Storage for diagnostic media uploads, wire up photo
capture and file picker in the diagnostic web app, and display image thumbnails in chat.

**Architecture:** The diagnostic agent backend uploads media to a Supabase Storage public bucket
using a service-role client (standard pattern for backend services — service role bypasses RLS). The
frontend captures photos via camera or file picker, sends base64 to the existing
`/diagnostics/:id/input` endpoint, and displays a local data-URL preview thumbnail in the chat
bubble.

**Tech Stack:** Supabase Storage, Supabase JS client (service role), Next.js 16, React 19, Hono

**Design doc:** `docs/plans/2026-02-22-diagnostic-image-upload-design.md`

---

### Task 1: Create Supabase Storage Bucket

**Files:**

- None (Supabase MCP operation)

**Step 1: Create the `diagnostic-media` bucket**

Use the Supabase MCP `apply_migration` tool:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('diagnostic-media', 'diagnostic-media', true);
```

This creates a **public** bucket. Public means anyone with the URL can read. The service role key
(used by the backend) bypasses all RLS, so **no storage policies are needed** — the backend is the
only writer.

**Step 2: Verify bucket exists**

Query: `SELECT id, name, public FROM storage.buckets WHERE id = 'diagnostic-media';` Expected: one
row with `public = true`.

---

### Task 2: Create Supabase Storage Wrapper

**Files:**

- Create: `apps/diagnostic-agent/src/lib/storage.ts`

**Step 1: Create `storage.ts`**

```typescript
import { createClient } from "@supabase/supabase-js";

const BUCKET = "diagnostic-media";

let _storageClient: ReturnType<typeof createClient> | null = null;

function getStorageClient(): ReturnType<typeof createClient> {
  if (!_storageClient) {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRoleKey) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for storage",
      );
    }
    _storageClient = createClient(url, serviceRoleKey);
  }
  return _storageClient;
}

export interface UploadResult {
  key: string;
  url: string;
}

export async function uploadMedia(
  file: Uint8Array,
  filename: string,
  contentType: string,
  sessionId: string,
): Promise<UploadResult> {
  const key = `${sessionId}/${Date.now()}-${filename}`;

  const { error } = await getStorageClient().storage
    .from(BUCKET)
    .upload(key, file, { contentType, upsert: false });

  if (error) {
    throw new Error(`[storage] Upload failed: ${error.message}`);
  }

  const { data } = getStorageClient().storage.from(BUCKET).getPublicUrl(key);
  return { key, url: data.publicUrl };
}

export async function getMedia(key: string): Promise<Uint8Array> {
  const { data, error } = await getStorageClient().storage
    .from(BUCKET)
    .download(key);

  if (error || !data) {
    throw new Error(`[storage] Download failed: ${error?.message ?? "No data"}`);
  }

  return new Uint8Array(await data.arrayBuffer());
}

export function getMediaUrl(key: string): string {
  const { data } = getStorageClient().storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

export async function deleteMedia(key: string): Promise<void> {
  const { error } = await getStorageClient().storage.from(BUCKET).remove([key]);
  if (error) {
    throw new Error(`[storage] Delete failed: ${error.message}`);
  }
}
```

Note: `getMediaUrl` is synchronous (no `async`) because `getPublicUrl` does not make a network call.

**Step 2: Verify the file type-checks**

Run: `deno check apps/diagnostic-agent/src/lib/storage.ts`

---

### Task 3: Update `env.ts` — Add Service Role Key, Remove R2 Vars

**Files:**

- Modify: `apps/diagnostic-agent/src/env.ts`
- Modify: `apps/diagnostic-agent/.env.example`

**Step 1: Update env schema in `env.ts`**

Replace:

```typescript
// Storage (optional for local dev)
R2_ACCOUNT_ID: z.string().optional(),
R2_ACCESS_KEY_ID: z.string().optional(),
R2_SECRET_ACCESS_KEY: z.string().optional(),
R2_BUCKET_NAME: z.string().default("diagnostic-media"),
```

With:

```typescript
// Storage (Supabase — service role for backend uploads)
SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
```

**Step 2: Update `.env.example`**

Replace the `# Storage (Cloudflare R2)` section with:

```
# Storage (Supabase — service role for backend uploads)
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**Step 3: Verify type-check**

Run: `deno check apps/diagnostic-agent/src/main.ts`

---

### Task 4: Update `routes/input.ts` — Use Supabase Storage

**Files:**

- Modify: `apps/diagnostic-agent/src/routes/input.ts`

**Step 1: Change import**

Replace:

```typescript
import { uploadMedia } from "../lib/r2.ts";
```

With:

```typescript
import { uploadMedia } from "../lib/storage.ts";
```

No other changes needed — `uploadMedia` keeps the same signature
`(file, filename, contentType, sessionId)`.

**Step 2: Verify type-check**

Run: `deno check apps/diagnostic-agent/src/main.ts`

---

### Task 5: Update `tools/storage.ts` — Use Supabase Storage + Rename R2 References

**Files:**

- Modify: `apps/diagnostic-agent/src/tools/storage.ts`

**Step 1: Change import**

Replace:

```typescript
import { getMedia, uploadMedia } from "../lib/r2.ts";
```

With:

```typescript
import { getMedia, uploadMedia } from "../lib/storage.ts";
```

**Step 2: Rename `r2Key` to `storageKey` in Zod schemas and update descriptions**

In `getMediaSchema`:

```typescript
const getMediaSchema = z.object({
  storageKey: z.string().describe("Storage key for the media file"),
});
```

In `saveMediaTool` return value:

```typescript
return toolResult({
  success: true,
  storageKey: result.key,
  url: result.url,
});
```

In `getMediaTool` execute:

```typescript
execute: async (params: z.infer<typeof getMediaSchema>) => {
  const { storageKey } = params;
  const data = await getMedia(storageKey);
  // ...
```

**Step 3: Verify type-check**

Run: `deno check apps/diagnostic-agent/src/main.ts`

---

### Task 6: Update `tools/extractVideoFrames.ts` — Use Supabase Storage + Rename R2 References

**Files:**

- Modify: `apps/diagnostic-agent/src/tools/extractVideoFrames.ts`

**Step 1: Change import**

Replace:

```typescript
import { getMedia, uploadMedia } from "../lib/r2.ts";
```

With:

```typescript
import { getMedia, uploadMedia } from "../lib/storage.ts";
```

**Step 2: Rename `r2Key` to `storageKey` in schema and usage**

In schema:

```typescript
const extractVideoFramesSchema = z.object({
  storageKey: z.string().describe("Storage key for the video file"),
  sessionId: z.string().describe("Session ID for storing extracted frames"),
  frameCount: z
    .number()
    .default(5)
    .describe("Number of frames to extract (default 5)"),
});
```

In execute:

```typescript
const { storageKey, sessionId, frameCount } = params;
// ...
const videoData = await getMedia(storageKey);
```

**Step 3: Verify type-check**

Run: `deno check apps/diagnostic-agent/src/main.ts`

---

### Task 7: Rename `r2Key` Column Alias in Drizzle Schema

**Files:**

- Modify: `apps/diagnostic-agent/src/db/schema.ts` (line ~116)
- Modify: `apps/diagnostic-agent/src/routes/input.ts` (line ~122)

**Step 1: Update Drizzle schema alias**

Keep the DB column name as `r2_key` (avoids a migration), but rename the TypeScript property:

In `schema.ts`, change:

```typescript
r2Key: text("r2_key").notNull(),
```

To:

```typescript
storageKey: text("r2_key").notNull(),
```

**Step 2: Update `input.ts` usage**

Change (around line 122):

```typescript
r2Key: uploadResult.key,
```

To:

```typescript
storageKey: uploadResult.key,
```

**Step 3: Check for any other `r2Key` usage in DB operations**

Run: `grep -r "r2Key" apps/diagnostic-agent/src/` — should return nothing after all changes.

**Step 4: Verify type-check**

Run: `deno check apps/diagnostic-agent/src/main.ts`

---

### Task 8: Delete R2 Code and Remove Dependency

**Files:**

- Delete: `apps/diagnostic-agent/src/lib/r2.ts`
- Modify: `apps/diagnostic-agent/deno.json`

**Step 1: Delete `r2.ts`**

Remove `apps/diagnostic-agent/src/lib/r2.ts` entirely.

**Step 2: Remove `@aws-sdk/client-s3` from `deno.json`**

In `apps/diagnostic-agent/deno.json`, remove this line from `"imports"`:

```json
"@aws-sdk/client-s3": "npm:@aws-sdk/client-s3@^3.990.0",
```

**Step 3: Run `deno install` to clean up lock file**

Run: `deno install` in `apps/diagnostic-agent/`

**Step 4: Full type-check and verify no R2 references remain**

Run: `deno check apps/diagnostic-agent/src/main.ts` Run:
`grep -r "r2\.\|R2_\|client-s3\|cloudflarestorage\|lib/r2" apps/diagnostic-agent/src/` — should
return nothing.

Note: `r2Key` as a column name in the DB is expected (we aliased it to `storageKey` in Drizzle), and
`storageKey: text("r2_key")` is fine.

**Step 5: Commit backend changes**

```bash
git add apps/diagnostic-agent/
git commit -m "feat(diagnostic): replace R2 with Supabase Storage"
```

---

### Task 9: Frontend — Add `imageUrl` to Message Type + `sendMessage` Options

**Files:**

- Modify: `apps/diagnostic-web/src/hooks/useAgentChat.ts`

**Step 1: Update Message interface (line 8-12)**

Change:

```typescript
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}
```

To:

```typescript
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
}
```

**Step 2: Add options parameter to `sendMessage` (line 49)**

Change:

```typescript
async (content: string) => {
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content,
  };
```

To:

```typescript
async (content: string, options?: { imageUrl?: string }) => {
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content,
    imageUrl: options?.imageUrl,
  };
```

**Step 3: Verify type-check**

Run: `cd apps/diagnostic-web && bun run typecheck`

---

### Task 10: Frontend — Wire Up `handlePhotoCapture`

**Files:**

- Modify: `apps/diagnostic-web/src/app/(app)/chat/page.tsx`

**Step 1: Add `Message` import (if not already imported)**

Add at top:

```typescript
import type { Message } from "@/hooks/useAgentChat";
```

**Step 2: Replace `handlePhotoCapture` (lines 128-136)**

Replace:

```typescript
const handlePhotoCapture = useCallback(
  (dataUrl: string) => {
    const base64 = dataUrl.split(",")[1];
    sendMessage(`[Photo attached] Analyze this image for vehicle diagnostics.`);
    // TODO: POST to /diagnostics/:id/input with type=photo and base64 content
    void base64;
  },
  [sendMessage],
);
```

With:

```typescript
const handlePhotoCapture = useCallback(
  async (dataUrl: string) => {
    if (!session?.access_token) return;

    const base64 = dataUrl.split(",")[1];

    // Create a session if we don't have one
    if (!sessionIdRef.current) {
      const res = await fetch(`${AGENT_URL}/diagnostics`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        sendMessage("[Photo upload failed]");
        return;
      }
      const data = await res.json();
      sessionIdRef.current = data.sessionId;
    }

    // Upload to backend
    const res = await fetch(
      `${AGENT_URL}/diagnostics/${sessionIdRef.current}/input`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "photo",
          content: base64,
          filename: `photo-${Date.now()}.jpg`,
          contentType: "image/jpeg",
        }),
      },
    );

    if (res.ok) {
      sendMessage(
        "[Photo attached] Analyze this image for vehicle diagnostics.",
        { imageUrl: dataUrl },
      );
    } else {
      sendMessage("[Photo upload failed — please try again]");
    }
  },
  [session?.access_token, sendMessage],
);
```

**Step 3: Verify type-check**

Run: `cd apps/diagnostic-web && bun run typecheck`

---

### Task 11: Frontend — Add File Picker

**Files:**

- Modify: `apps/diagnostic-web/src/components/chat/ChatInput.tsx`
- Modify: `apps/diagnostic-web/src/app/(app)/chat/page.tsx`

**Step 1: Update `ChatInput.tsx`**

Add `onFilePick` to props interface:

```typescript
interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  onCameraClick?: () => void;
  onMicClick?: () => void;
  onObdClick?: () => void;
  onFilePick?: (file: File) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}
```

Update imports:

```typescript
import { Camera, Cpu, ImagePlus, Mic, Send } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
```

Add `fileInputRef` and destructure `onFilePick`:

```typescript
export function ChatInput({
  onSend,
  isLoading,
  onCameraClick,
  onMicClick,
  onObdClick,
  onFilePick,
  inputRef,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
```

Add hidden file input + button after the camera button in the JSX:

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/*"
  className="hidden"
  onChange={(e) => {
    const file = e.target.files?.[0];
    if (file && onFilePick) onFilePick(file);
    e.target.value = "";
  }}
/>
<button
  type="button"
  onClick={() => fileInputRef.current?.click()}
  className="p-2.5 rounded-full bg-surface-alt text-text-secondary hover:text-text transition-colors"
  aria-label="Upload photo"
>
  <ImagePlus className="w-5 h-5" />
</button>
```

**Step 2: Add `handleFilePick` in `chat/page.tsx`**

```typescript
const handleFilePick = useCallback(
  (file: File) => {
    if (!session?.access_token) return;

    // Reject files over 10MB
    if (file.size > 10 * 1024 * 1024) {
      sendMessage("[Photo too large — maximum 10MB]");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];

      // Create session if needed
      if (!sessionIdRef.current) {
        const res = await fetch(`${AGENT_URL}/diagnostics`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          sendMessage("[Photo upload failed]");
          return;
        }
        const data = await res.json();
        sessionIdRef.current = data.sessionId;
      }

      // Upload
      const res = await fetch(
        `${AGENT_URL}/diagnostics/${sessionIdRef.current}/input`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "photo",
            content: base64,
            filename: file.name,
            contentType: file.type || "image/jpeg",
          }),
        },
      );

      if (res.ok) {
        sendMessage(
          "[Photo attached] Analyze this image for vehicle diagnostics.",
          { imageUrl: dataUrl },
        );
      } else {
        sendMessage("[Photo upload failed — please try again]");
      }
    };
    reader.readAsDataURL(file);
  },
  [session?.access_token, sendMessage],
);
```

**Step 3: Wire up in JSX**

```tsx
<ChatInput
  onSend={sendMessage}
  isLoading={isLoading}
  inputRef={inputRef}
  onCameraClick={() => setShowCamera(true)}
  onMicClick={() => setShowAudioRecorder(true)}
  onObdClick={() => setShowObdInput(true)}
  onFilePick={handleFilePick}
/>;
```

**Step 4: Verify type-check**

Run: `cd apps/diagnostic-web && bun run typecheck`

---

### Task 12: Frontend — Render Image Thumbnails in MessageBubble

**Files:**

- Modify: `apps/diagnostic-web/src/components/chat/MessageBubble.tsx`

**Step 1: Update MessageBubble to render images**

Replace the full file:

```tsx
"use client";

import { Markdown } from "@/components/ui/Markdown";
import type { Message } from "@/hooks/useAgentChat";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser ? "bg-primary text-white rounded-br-md" : "bg-surface-alt text-text rounded-bl-md"
        }`}
      >
        {message.imageUrl && (
          <img
            src={message.imageUrl}
            alt="Uploaded photo"
            className="rounded-lg max-w-full mb-2"
          />
        )}
        {isUser ? <p>{message.content}</p> : <Markdown content={message.content} />}
      </div>
    </div>
  );
}
```

Note: The `<img>` tag is used intentionally here — the `src` is either a data URL (local preview) or
a Supabase Storage public URL. It is not a static asset suitable for `next/image`. If Biome flags
`lint/performance/noImgElement`, add the suppress comment.

**Step 2: Verify type-check and lint**

Run: `cd apps/diagnostic-web && bun run typecheck` Run: `cd apps/diagnostic-web && bun run lint`

---

### Task 13: Final Verification

**Step 1: Full backend type-check**

Run: `deno task check:diagnostic` Expected: No errors.

**Step 2: Full frontend checks**

Run: `cd apps/diagnostic-web && bun run typecheck` Run: `cd apps/diagnostic-web && bun run lint`
Expected: No errors.

**Step 3: Grep for leftover R2 import/usage references**

Run:
`grep -r "lib/r2\|R2_\|client-s3\|cloudflarestorage" apps/diagnostic-agent/src/ apps/diagnostic-web/src/`
Expected: No results.

Run: `grep -r "r2Key" apps/diagnostic-agent/src/` Expected: Only `storageKey: text("r2_key")` in
schema.ts (the DB column alias).

**Step 4: Commit frontend changes**

```bash
git add apps/diagnostic-web/
git commit -m "feat(diagnostic-web): wire photo upload and image thumbnails in chat"
```
