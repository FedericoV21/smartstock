import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

const BUCKET = 'facturas-recibidas';

export async function subirArchivoFacturaRecibida(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  buffer: ArrayBuffer | Uint8Array,
  fileName: string,
  mimeType: string,
): Promise<{ path: string; error: Error | null }> {
  const timestamp = Date.now();
  const nonce =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${tenantId}/lector/${timestamp}_${nonce}_${safeName}`;
  const body = buffer instanceof Uint8Array
    ? Buffer.from(buffer)
    : Buffer.from(new Uint8Array(buffer));

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, body, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    return { path: storagePath, error: new Error(error.message) };
  }

  return { path: storagePath, error: null };
}
