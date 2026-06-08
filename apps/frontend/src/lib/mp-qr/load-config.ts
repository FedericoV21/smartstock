import type { SupabaseClient } from '@supabase/supabase-js';

import { desencriptarCampo } from '@/lib/facturacion/arca/crypto';
import type { Database } from '@/types/database';

export type MpQrConfigRow = {
  access_token: string | null;
  user_id: string | null;
  external_pos_id: string | null;
  webhook_secret: string | null;
  habilitado: boolean;
};

export async function loadMpQrConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId?: string | null,
): Promise<{ data: MpQrConfigRow | null; error: string | null }> {
  let q = supabase
    .from('mp_qr_config')
    .select('access_token, user_id, external_pos_id, webhook_secret, habilitado')
    .eq('tenant_id', tenantId);

  if (sucursalId) {
    q = q.eq('sucursal_id', sucursalId);
  } else {
    q = q.order('created_at', { ascending: true }).limit(1);
  }

  const { data, error } = await q.maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }
  return { data: data as MpQrConfigRow | null, error: null };
}

export function decryptMpQrAccessToken(encrypted: string | null | undefined): string | null {
  if (!encrypted || !String(encrypted).trim()) return null;
  try {
    return desencriptarCampo(String(encrypted).trim());
  } catch {
    return null;
  }
}
