import { NextResponse } from 'next/server';

import { rejectUnlessDespieceVer } from '@/lib/api/permissions';
import { getTenantSession } from '@/lib/api/tenant-session';
import { calcular4Estrategias } from '@/lib/despiece/motor';
import { moduloGuardDespieceConNegocio } from '@/lib/modulos/guard';

function readRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceVer(session.supabase, session);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  try {
    const b = readRecord(body);
    const input = {
      nombre: typeof b.nombre === 'string' ? b.nombre : undefined,
      costoKgPadre: Number(b.costoKgPadre ?? b.costo_kg_padre),
      pesoTotalKg: Number(b.pesoTotalKg ?? b.peso_total_kg),
      rentabilidadObjetivoPct: Number(b.rentabilidadObjetivoPct ?? b.rentabilidad_objetivo_pct ?? 0),
      cortes: Array.isArray(b.cortes)
        ? b.cortes.map((raw) => {
            const c = readRecord(raw);
            return {
              id: typeof c.id === 'string' ? c.id : undefined,
              nombre: String(c.nombre ?? ''),
              kgRendimiento: Number(c.kgRendimiento ?? c.kg_rendimiento),
              factorAjustePct: Number(c.factorAjustePct ?? c.factor_ajuste_pct ?? 0),
              precioAnclado:
                c.precioAnclado == null && c.precio_anclado == null
                  ? null
                  : Number(c.precioAnclado ?? c.precio_anclado),
              precioCorreccion:
                c.precioCorreccion == null && c.precio_correccion == null
                  ? null
                  : Number(c.precioCorreccion ?? c.precio_correccion),
            };
          })
        : [],
    };

    return NextResponse.json({ resultado: calcular4Estrategias(input) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo calcular.' },
      { status: 400 },
    );
  }
}

