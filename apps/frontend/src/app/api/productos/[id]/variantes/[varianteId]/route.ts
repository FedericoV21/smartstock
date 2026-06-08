import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import { moduloGuard } from '@/lib/modulos/guard';
import {
  atributosVarianteToJson,
  etiquetaVariante,
  normalizarAtributosVariante,
} from '@/lib/productos/variantes';
import type { Database } from '@/types/database';

type ProductoVarianteUpdate = Database['public']['Tables']['producto_variante']['Update'];

async function assertEditable(productoId: string, varianteId: string) {
  const session = await getTenantSession();
  if ('error' in session) return { ok: false as const, response: session.error };

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return { ok: false as const, response: operable.response };

  const { data: producto, error: pErr } = await session.supabase
    .from('producto')
    .select('id, sucursal_id')
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (pErr) return { ok: false as const, response: NextResponse.json({ error: pErr.message }, { status: 500 }) };
  if (!producto?.sucursal_id) {
    return { ok: false as const, response: NextResponse.json({ error: 'Producto no encontrado.' }, { status: 404 }) };
  }
  if (!operable.ids.includes(producto.sucursal_id)) {
    return { ok: false as const, response: NextResponse.json({ error: 'No tenés permisos para este producto.' }, { status: 403 }) };
  }

  const { data: variante, error: vErr } = await session.supabase
    .from('producto_variante')
    .select('id, producto_id')
    .eq('id', varianteId)
    .eq('producto_id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (vErr) return { ok: false as const, response: NextResponse.json({ error: vErr.message }, { status: 500 }) };
  if (!variante) {
    return { ok: false as const, response: NextResponse.json({ error: 'Variante no encontrada.' }, { status: 404 }) };
  }

  const prefs = await loadEffectiveBusinessPrefs(session.supabase, session.tenantId, producto.sucursal_id);
  if (!prefs.productosVariantesHabilitado) {
    return { ok: false as const, response: NextResponse.json({ error: 'Las variantes todavía no están habilitadas para este negocio.' }, { status: 403 }) };
  }

  return { ok: true as const, session, producto, operableIds: operable.ids };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; varianteId: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const forbiddenSession = await getTenantSession();
  if ('error' in forbiddenSession) return forbiddenSession.error;
  const forbidden = rejectIfVisor(forbiddenSession.rol);
  if (forbidden) return forbidden;

  const { id, varianteId } = await params;
  const scoped = await assertEditable(id, varianteId);
  if (!scoped.ok) return scoped.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  const updates: ProductoVarianteUpdate = {};
  if (b.atributos !== undefined) updates.atributos = atributosVarianteToJson(normalizarAtributosVariante(b.atributos));
  if (b.etiqueta !== undefined) updates.etiqueta = typeof b.etiqueta === 'string' && b.etiqueta.trim() ? b.etiqueta.trim() : null;
  if (b.codigo !== undefined) updates.codigo = typeof b.codigo === 'string' && b.codigo.trim() ? b.codigo.trim() : null;
  if (b.codigo_barras !== undefined) {
    const bar = typeof b.codigo_barras === 'string' && b.codigo_barras.trim() ? b.codigo_barras.trim() : null;
    if (bar) {
      const { data: productoConBarra } = await scoped.session.supabase
        .from('producto')
        .select('id, nombre')
        .eq('tenant_id', scoped.session.tenantId)
        .eq('codigo_barras', bar)
        .eq('activo', true)
        .limit(1)
        .maybeSingle();
      if (productoConBarra) {
        return NextResponse.json(
          { error: `Ese código de barras ya pertenece al producto "${productoConBarra.nombre}".` },
          { status: 409 },
        );
      }
    }
    updates.codigo_barras = bar;
  }
  if (b.activo !== undefined) updates.activo = b.activo === true;
  if (b.orden !== undefined && Number.isFinite(Number(b.orden))) updates.orden = Number(b.orden);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Sin cambios.' }, { status: 400 });
  }

  const { data, error } = await scoped.session.supabase
    .from('producto_variante')
    .update(updates)
    .eq('id', varianteId)
    .eq('producto_id', id)
    .eq('tenant_id', scoped.session.tenantId)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Ya existe una variante activa con esos datos.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ...(data as Record<string, unknown>),
    etiqueta: etiquetaVariante((data as { atributos?: unknown }).atributos, (data as { etiqueta?: string | null }).etiqueta),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; varianteId: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id, varianteId } = await params;
  const scoped = await assertEditable(id, varianteId);
  if (!scoped.ok) return scoped.response;

  const { error } = await scoped.session.supabase
    .from('producto_variante')
    .update({ activo: false })
    .eq('id', varianteId)
    .eq('producto_id', id)
    .eq('tenant_id', scoped.session.tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
