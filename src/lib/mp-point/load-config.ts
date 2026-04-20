import type { SupabaseClient } from '@supabase/supabase-js';

import { desencriptarCampo } from '@/lib/facturacion/arca/crypto';
import type { Database } from '@/types/database';

export type MpPointConfigRow = {
  access_token: string | null;
  device_id: string | null;
  webhook_secret: string | null;
  habilitado: boolean;
};

export async function loadMpPointConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ data: MpPointConfigRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('mp_point_config')
    .select('access_token, device_id, webhook_secret, habilitado')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: data as MpPointConfigRow | null, error: null };
}

/** Devuelve token en claro o null si no hay / error al desencriptar. */
export function decryptAccessToken(encrypted: string | null | undefined): string | null {
  if (!encrypted || !String(encrypted).trim()) return null;
  try {
    return desencriptarCampo(String(encrypted).trim());
  } catch {
    return null;
  }
}
