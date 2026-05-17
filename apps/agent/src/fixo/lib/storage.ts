import { createClient } from "@supabase/supabase-js";

const BUCKET = "fixo-media";

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

  // Bucket is private. Callers that need a URL should mint a short-lived
  // signed read URL via createSignedReadUrl when the URL is about to be
  // consumed (e.g., right before handing it to a model provider).
  return { key };
}

export interface SignedUpload {
  key: string;
  signedUrl: string;
  token: string;
}

/**
 * Mint a one-shot URL the client can PUT a raw file body to directly,
 * bypassing the gateway entirely. The gateway issues this URL only after
 * auth + credit checks; /complete finalizes the fixoMedia row once the
 * upload lands. Default Supabase TTL (~2h) is fine — the client starts the
 * PUT immediately and the bucket-side cap (file_size_limit) is the real
 * abuse ceiling.
 */
export async function createSignedUploadUrl(
  key: string,
): Promise<SignedUpload> {
  const { data, error } = await getStorageClient().storage
    .from(BUCKET)
    .createSignedUploadUrl(key);
  if (error || !data) {
    throw new Error(
      `[storage] createSignedUploadUrl failed for ${key}: ${error?.message ?? "no data"}`,
    );
  }
  return { key, signedUrl: data.signedUrl, token: data.token };
}

/**
 * Look up an uploaded object's actual size + content type. /complete uses
 * this to verify the client wrote what they said they would in /init —
 * guards against a client lying about size to underpay credits, or against
 * a silently-failed upload being marked complete. Returns null when the
 * object is missing (upload never finished, or a fabricated mediaId).
 */
export async function getObjectInfo(
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  const { data, error } = await getStorageClient().storage
    .from(BUCKET)
    .info(key);
  if (error || !data) return null;
  return {
    size: data.size ?? 0,
    contentType: data.contentType ?? "application/octet-stream",
  };
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

/**
 * Create a short-lived signed read URL for a stored object.
 *
 * Used by /task to hydrate fixoMedia rows into the model's input as
 * FileUIParts without making the bucket public. The TTL only needs to
 * outlive the model's own fetch — diagnostic media may contain VINs,
 * plates, addresses, faces, so we keep it as tight as practical.
 */
export async function createSignedReadUrl(
  key: string,
  expiresInSeconds = 900,
): Promise<string> {
  const { data, error } = await getStorageClient().storage
    .from(BUCKET)
    .createSignedUrl(key, expiresInSeconds);
  if (error || !data) {
    throw new Error(
      `[storage] createSignedUrl failed for ${key}: ${error?.message ?? "no data"}`,
    );
  }
  return data.signedUrl;
}

export async function deleteMedia(key: string): Promise<void> {
  const { error } = await getStorageClient().storage.from(BUCKET).remove([key]);
  if (error) {
    throw new Error(`[storage] Delete failed: ${error.message}`);
  }
}
