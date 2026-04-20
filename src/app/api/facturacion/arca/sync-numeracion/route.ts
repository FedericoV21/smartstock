import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { consultarUltimoComprobante } from '@/lib/facturacion/arca/wsfe';
import { moduloGuard } from '@/lib/modulos/guard';

const TIPOS_SYNC = ['factura_a', 'factura_b', 'factura_c'] as const;

export async function POST() {
  const guard = await moduloGuard('facturador_arca');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  if (session.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo admin puede sincronizar' }, { status: 403 });
  }

  const { data: arcaConfig } = await session.supabase
    .from('arca_config')
    .select('*')
    .eq('tenant_id', session.tenantId)
    .single();

  if (!arcaConfig || !arcaConfig.cuit_emisor || !arcaConfig.punto_de_venta) {
    return NextResponse.json({ error: 'Configuración ARCA incompleta' }, { status: 400 });
  }

  const config = {
    tenant_id: arcaConfig.tenant_id,
    cuit_emisor: arcaConfig.cuit_emisor,
    punto_de_venta: arcaConfig.punto_de_venta,
    ambiente: arcaConfig.ambiente,
  };

  const resultados: Record<string, { arca: number; local: number; discrepancia: boolean }> = {};

  for (const tipo of TIPOS_SYNC) {
    try {
      const ultimoArca = await consultarUltimoComprobante(session.supabase, config, tipo);

      const { data: ultimoLocal } = await session.supabase
        .from('comprobante')
        .select('numero')
        .eq('tenant_id', session.tenantId)
        .eq('tipo', tipo)
        .neq('estado', 'error_arca')
        .order('numero', { ascending: false })
        .limit(1)
        .maybeSingle();

      const localNum = ultimoLocal?.numero ?? 0;

      resultados[tipo] = {
        arca: ultimoArca,
        local: localNum,
        discrepancia: ultimoArca !== localNum,
      };
    } catch {
      resultados[tipo] = { arca: -1, local: -1, discrepancia: true };
    }
  }

  const ultimoGeneral = Math.max(
    ...Object.values(resultados).map((r) => r.arca).filter((n) => n >= 0),
    0,
  );

  await session.supabase
    .from('arca_config')
    .update({ ultimo_comprobante: ultimoGeneral })
    .eq('tenant_id', session.tenantId);

  return NextResponse.json({ resultados });
}
