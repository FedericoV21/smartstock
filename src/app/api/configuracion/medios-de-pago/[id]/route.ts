import { NextResponse } from 'next/server';

import { getTenantSession, rejectUnlessAdmin, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const adminOnly = rejectUnlessAdmin(session.rol);
  if (adminOnly) return adminOnly;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  const { data: existente, error: exErr } = await session.supabase
    .from('medio_pago')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (exErr || !existente) {
    return NextResponse.json({ error: 'Medio de pago no encontrado.' }, { status: 404 });
  }

  const patch: {
    nombre?: string;
    activo?: boolean;
    orden?: number;
  } = {};
  if (typeof b.nombre === 'string' && b.nombre.trim()) patch.nombre = b.nombre.trim();
  if (typeof b.activo === 'boolean') patch.activo = b.activo;
  if (typeof b.orden === 'number' && !Number.isNaN(b.orden)) patch.orden = Math.floor(b.orden);

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await session.supabase.from('medio_pago').update(patch).eq('id', id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  if (Array.isArray(b.opciones) && b.opciones.length > 0) {
    const opciones: { cuotas: number; recargo_porcentaje: number }[] = [];
    for (const row of b.opciones) {
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
        return NextResponse.json({ error: 'Porcentaje inválido.' }, { status: 400 });
      }
      opciones.push({ cuotas, recargo_porcentaje: pct });
    }

    const cuotasSet = new Set(opciones.map((o) => o.cuotas));
    if (cuotasSet.size !== opciones.length) {
      return NextResponse.json({ error: 'No puede haber dos filas con la misma cantidad de cuotas.' }, { status: 400 });
    }

    await session.supabase.from('medio_pago_opcion').delete().eq('medio_pago_id', id);

    const { error: opErr } = await session.supabase.from('medio_pago_opcion').insert(
      opciones.map((o) => ({
        medio_pago_id: id,
        cuotas: o.cuotas,
        recargo_porcentaje: o.recargo_porcentaje,
      })),
    );

    if (opErr) {
      return NextResponse.json({ error: opErr.message }, { status: 500 });
    }
  }

  const { data: medio, error } = await session.supabase
    .from('medio_pago')
    .select(`id, nombre, activo, orden, created_at, medio_pago_opcion ( id, cuotas, recargo_porcentaje )`)
    .eq('id', id)
    .single();

  if (error || !medio) {
    return NextResponse.json({ error: error?.message ?? 'Error al leer' }, { status: 500 });
  }

  return NextResponse.json({ medio });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const adminOnly = rejectUnlessAdmin(session.rol);
  if (adminOnly) return adminOnly;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
  }

  const { error } = await session.supabase.from('medio_pago').delete().eq('id', id).eq('tenant_id', session.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
