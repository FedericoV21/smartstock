import { NextResponse } from 'next/server';

import { withTesoreriaApi } from '@/lib/tesoreria/api-context';

export async function GET(request: Request) {
  return withTesoreriaApi(request, async ({ session, db, sucursalId }) => {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 50);

    let q = (db as any)
      .from('cierre_z')
      .select('id, caja_id, fecha_operativa, rango_desde, rango_hasta, ventas_netas, payload_resumen, created_at')
      .eq('tenant_id', session.tenantId)
      .eq('tipo_cierre', 'diario')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (sucursalId) {
      q = q.eq('sucursal_id', sucursalId);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const cierres = ((data ?? []) as Array<Record<string, unknown>>).map((c) => {
      const arqueo = (c.payload_resumen as { arqueo_efectivo?: { contado?: number } } | null)
        ?.arqueo_efectivo;
      return {
        id: c.id,
        caja_id: c.caja_id,
        fecha_operativa: c.fecha_operativa,
        rango_desde: c.rango_desde,
        rango_hasta: c.rango_hasta,
        ventas_netas: c.ventas_netas,
        efectivo_contado: arqueo?.contado ?? null,
        created_at: c.created_at,
      };
    });

    const cajaIds = [...new Set(cierres.map((c) => c.caja_id).filter(Boolean))];
    let cajasMap: Record<string, string> = {};
    const uuids = cajaIds.filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));
    if (uuids.length > 0) {
      const { data: cajas } = await (db as any)
        .from('caja')
        .select('id, nombre, numero')
        .eq('tenant_id', session.tenantId)
        .in('id', uuids);
      cajasMap = Object.fromEntries(
        ((cajas ?? []) as { id: string; nombre: string | null; numero: number }[]).map((c) => [
          c.id,
          c.nombre?.trim() || `Caja ${c.numero}`,
        ]),
      );
    }

    return NextResponse.json({
      cierres: cierres.map((c) => ({
        ...c,
        caja_id: String(c.caja_id ?? ''),
        caja_etiqueta: cajasMap[String(c.caja_id ?? '')] ?? 'Caja',
      })),
    });
  });
}
