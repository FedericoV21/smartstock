import { NextResponse } from 'next/server';

import { reintentarCaeComprobante } from '@/lib/facturacion/reintentar-cae-comprobante';
import { createServiceRoleClient } from '@/lib/supabase/server';

const BATCH = 10;
const MAX_INTENTOS = 3;

/**
 * Procesa comprobantes `pendiente_arca` (cola; p. ej. cron cada 15 min).
 * Autenticación: `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: pendientes, error: qErr } = await supabase
    .from('comprobante')
    .select('id, tenant_id, intentos_arca, estado')
    .eq('estado', 'pendiente_arca')
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  if (!pendientes?.length) {
    return NextResponse.json({ procesados: 0, mensaje: 'Sin comprobantes pendientes' });
  }

  let procesados = 0;
  let exitosos = 0;
  let aErrorArca = 0;

  for (const p of pendientes) {
    const intentos = p.intentos_arca ?? 0;
    if (intentos >= MAX_INTENTOS) {
      await supabase
        .from('comprobante')
        .update({
          estado: 'error_arca' as never,
          ultimo_error_arca_codigo: 'MAX_REINTENTOS',
          ultimo_error_arca_mensaje: `Se alcanzó el máximo de ${MAX_INTENTOS} intentos de solicitud CAE.`,
        })
        .eq('id', p.id);
      aErrorArca++;
      procesados++;
      continue;
    }

    const r = await reintentarCaeComprobante(supabase, { tenantId: p.tenant_id }, p.id);
    if (r.ok) {
      exitosos++;
    } else if (r.status === 503) {
      // Sigue pendiente; intentos ya incrementó solicitarCaeYAsignarNumero
    } else {
      aErrorArca++;
    }
    procesados++;
  }

  return NextResponse.json({ procesados, exitosos, a_error_arca: aErrorArca });
}
