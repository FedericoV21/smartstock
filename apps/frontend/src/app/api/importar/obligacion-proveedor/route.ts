import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { insertarObligacionImportLista } from '@/lib/importar/registrar-obligacion-import-lista';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

type ModuloOrigen = 'importador_excel' | 'ia_precios';

function moduloDesdeOrigen(
  o: string | undefined,
): ModuloOrigen {
  if (o === 'ia_pdf') return 'ia_precios';
  return 'importador_excel';
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: {
    proveedor_id?: string;
    monto?: number;
    modo?: 'condicion' | 'fecha_fija';
    fecha_operacion_ymd?: string;
    vencimiento_ymd?: string | null;
    referencia?: string;
    origen_precio?: Database['public']['Enums']['origen_precio'];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const origenPrecio = body.origen_precio ?? 'importacion_excel';
  const mod = moduloDesdeOrigen(origenPrecio);
  const guard = await moduloGuard(mod);
  if (!guard.allowed) return guard.response;

  if (!body.proveedor_id || !body.monto) {
    return NextResponse.json({ error: 'Faltan proveedor_id o monto' }, { status: 400 });
  }
  if (body.modo !== 'condicion' && body.modo !== 'fecha_fija') {
    return NextResponse.json({ error: 'modo debe ser condicion o fecha_fija' }, { status: 400 });
  }

  try {
    const res = await insertarObligacionImportLista(session.supabase, { tenantId: session.tenantId }, {
      proveedorId: body.proveedor_id,
      monto: body.monto,
      modo: body.modo,
      fechaOperacionYmd: body.fecha_operacion_ymd ?? new Date().toISOString().slice(0, 10),
      vencimientoYmd: body.vencimiento_ymd ?? undefined,
      referencia: body.referencia ?? 'Importación de lista',
    });
    console.info('[importar/obligacion]', 'registrada', { idShort: `${res.id.slice(0, 8)}…` });
    return NextResponse.json({ id: res.id });
  } catch (e) {
    console.error('[importar/obligacion]', (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
