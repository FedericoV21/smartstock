import type { SupabaseClient } from '@supabase/supabase-js';

import { reintentarCaeComprobante } from '@/lib/facturacion/reintentar-cae-comprobante';
import type { Database } from '@/types/database';

/** Reintentos tras emisión con `pendiente_arca` / `error_arca` (webhook MP, cron, etc.). */
export const ARCA_REINTENTOS_AUTO_SERVIDOR = 3;
export const ARCA_ESPERA_ENTRE_REINTENTOS_SERVIDOR_MS = 1_200;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Vuelve a llamar a `reintentarCaeComprobante` hasta `maxIntentos` veces si sigue fallando.
 * Útil cuando AFIP/ARCA responde intermitente o la numeración se alinea en el segundo intento.
 */
export async function reintentarCaeAutomaticoServidor(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string },
  comprobanteId: string,
  options?: { maxIntentos?: number; esperaEntreMs?: number },
): Promise<{ ok: boolean }> {
  const maxIntentos = options?.maxIntentos ?? ARCA_REINTENTOS_AUTO_SERVIDOR;
  const esperaEntreMs = options?.esperaEntreMs ?? ARCA_ESPERA_ENTRE_REINTENTOS_SERVIDOR_MS;

  for (let i = 0; i < maxIntentos; i++) {
    if (i > 0) await sleepMs(esperaEntreMs);
    const r = await reintentarCaeComprobante(supabase, ctx, comprobanteId);
    if (r.ok) return { ok: true };
  }
  return { ok: false };
}
