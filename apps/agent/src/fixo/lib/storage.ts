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
