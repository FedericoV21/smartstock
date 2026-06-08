import { NextResponse } from 'next/server';

import { getTenantSession, rejectUnlessAdmin, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET() {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const [mediosRes, rapidosRes] = await Promise.all([
    session.supabase
      .from('medio_pago')
      .select(
        `
      id,
      nombre,
      activo,
      orden,
      created_at,
      medio_pago_opcion ( id, cuotas, recargo_porcentaje )
    `,
      )
      .eq('tenant_id', session.tenantId)
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true }),
    session.supabase
      .from('medio_pago_rapido')
      .select('codigo, recargo_porcentaje')
      .eq('tenant_id', session.tenantId),
  ]);

  if (mediosRes.error) {
    return NextResponse.json({ error: mediosRes.error.message }, { status: 500 });
  }
  if (rapidosRes.error) {
    return NextResponse.json({ error: rapidosRes.error.message }, { status: 500 });
  }

  const medios = (mediosRes.data ?? []).map((m) => ({
    ...m,
    medio_pago_opcion: [...(m.medio_pago_opcion as { id: string; cuotas: number; recargo_porcentaje: number }[])].sort(
      (a, b) => a.cuotas - b.cuotas,
    ),
  }));

  const rapidos: Record<string, number> = {
    efectivo: 0,
    debito: 0,
    credito: 0,
    transferencia: 0,
    mixto: 0,
  };
  for (const row of rapidosRes.data ?? []) {
    const c = row.codigo as keyof typeof rapidos;
    if (c in rapidos) {
      rapidos[c] = Number(row.recargo_porcentaje);
    }
  }

  return NextResponse.json({ medios, rapidos });
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const adminOnly = rejectUnlessAdmin(session.rol);
  if (adminOnly) return adminOnly;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const nombre = String(b.nombre ?? '').trim();
  if (!nombre) {
    return NextResponse.json({ error: 'El nombre es obligatorio.' }, { status: 400 });
  }

  const activo = b.activo !== false;
  const orden = typeof b.orden === 'number' && !Number.isNaN(b.orden) ? Math.floor(b.orden) : 0;

  const opcionesRaw = b.opciones;
  if (!Array.isArray(opcionesRaw) || opcionesRaw.length === 0) {
    return NextResponse.json(
      { error: 'Agregá al menos una fila de cuotas y recargo/descuento (%).' },
      { status: 400 },
    );
  }

  const opciones: { cuotas: number; recargo_porcentaje: number }[] = [];
  for (const row of opcionesRaw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const cuotas = typeof r.cuotas === 'number' ? Math.floor(r.cuotas) : parseInt(String(r.cuotas), 10);
    const pct =
      typeof r.recargo_porcentaje === 'number'
        ? r.recargo_porcentaje
        : parseFloat(String(r.recargo_porcentaje ?? ''));
    if (!Number.isFinite(cuotas) || cuotas < 1) {
      return NextResponse.json({ error: 'Cada opción debe tener cuotas ≥ 1.' }, { status: 400 });
    }
    if (!Number.isFinite(pct)) {
      return NextResponse.json({ error: 'Porcentaje inválido en las opciones.' }, { status: 400 });
    }
    opciones.push({ cuotas, recargo_porcentaje: pct });
  }

  const cuotasSet = new Set(opciones.map((o) => o.cuotas));
  if (cuotasSet.size !== opciones.length) {
    return NextResponse.json({ error: 'No puede haber dos filas con la misma cantidad de cuotas.' }, { status: 400 });
  }

  if (opciones.length === 0) {
    return NextResponse.json({ error: 'No hay opciones válidas.' }, { status: 400 });
  }

  const { data: medio, error: insErr } = await session.supabase
    .from('medio_pago')
    .insert({
      tenant_id: session.tenantId,
      nombre,
      activo,
      orden,
    })
    .select('id')
    .single();

  if (insErr || !medio) {
    return NextResponse.json({ error: insErr?.message ?? 'No se pudo crear el medio de pago.' }, { status: 500 });
  }

  const { error: opErr } = await session.supabase.from('medio_pago_opcion').insert(
    opciones.map((o) => ({
      medio_pago_id: medio.id,
      cuotas: o.cuotas,
      recargo_porcentaje: o.recargo_porcentaje,
    })),
  );

  if (opErr) {
    await session.supabase.from('medio_pago').delete().eq('id', medio.id);
    return NextResponse.json({ error: opErr.message }, { status: 500 });
  }

  const { data: completo, error: fetchErr } = await session.supabase
    .from('medio_pago')
    .select(
      `id, nombre, activo, orden, created_at, medio_pago_opcion ( id, cuotas, recargo_porcentaje )`,
    )
    .eq('id', medio.id)
    .single();

  if (fetchErr || !completo) {
    return NextResponse.json({ medio: { id: medio.id, nombre, activo, orden } }, { status: 201 });
  }

  return NextResponse.json({ medio: completo }, { status: 201 });
}
