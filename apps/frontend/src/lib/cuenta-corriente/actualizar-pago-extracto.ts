import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export type ActualizarPagoExtractoInput = {
  pagoId: string;
  monto: number;
  fecha: string;
  tipo_pago: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' | 'otro';
  referencia?: string | null;
  notas?: string | null;
};

export async function actualizarPagoExtracto(
  supabase: SupabaseClient<Database>,
  input: ActualizarPagoExtractoInput,
): Promise<{ ok: true; delta: number } | { ok: false; error: string; status: number }> {
  const monto = Math.round(Number(input.monto) * 100) / 100;
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, error: 'El monto debe ser mayor a cero.', status: 400 };
  }
  const fecha = input.fecha?.trim();
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { ok: false, error: 'Fecha inválida.', status: 400 };
  }

  const { data, error } = await supabase.rpc('actualizar_pago_cliente_extracto', {
    p_pago_id: input.pagoId,
    p_monto: monto,
    p_fecha: fecha,
    p_tipo_pago: input.tipo_pago,
    p_referencia: input.referencia ?? null,
    p_notas: input.notas ?? null,
  });

  if (error) {
    const msg = error.message ?? 'No se pudo actualizar el pago.';
    const status = msg.includes('no encontrado') ? 404 : 400;
    return { ok: false, error: msg, status };
  }

  const delta =
    data && typeof data === 'object' && 'delta' in data
      ? Number((data as { delta?: unknown }).delta)
      : 0;

  return { ok: true, delta: Number.isFinite(delta) ? delta : 0 };
}
