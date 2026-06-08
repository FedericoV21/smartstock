import { NextResponse } from 'next/server';

import { crearListaConItems, type ItemExtraido } from '@/lib/analizador/extraer-lista';
import { round2 } from '@/lib/analizador/descuento-proveedor';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor, rejectUnlessAnalizadorAccess } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

type OrigenPrecio = Database['public']['Enums']['origen_precio'];

// ---------------------------------------------------------------------------
// POST /api/analizador/listas/confirm — Persiste lista luego del preview
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const guard = await moduloGuard('importador_excel');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const noAnalizador = rejectUnlessAnalizadorAccess(session.rol);
  if (noAnalizador) return noAnalizador;

  const { supabase, tenantId, userId } = session;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;

  let body: {
    proveedor_id?: string;
    storage_path?: string | null;
    nombre_archivo?: string;
    mime_type?: string;
    origen?: OrigenPrecio;
    descuento_proveedor_pct?: number;
    items?: ItemExtraido[];
    fecha_vigencia_desde?: string | null;
    fecha_vigencia_hasta?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const proveedorId = body.proveedor_id;
  if (!proveedorId) {
    return NextResponse.json({ error: 'proveedor_id es obligatorio' }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'Se requieren items extraídos' }, { status: 400 });
  }
  if (!body.nombre_archivo || !body.origen) {
    return NextResponse.json({ error: 'nombre_archivo y origen son obligatorios' }, { status: 400 });
  }
  if (body.mime_type == null) {
    return NextResponse.json({ error: 'mime_type es obligatorio' }, { status: 400 });
  }

  const { data: proveedor } = await supabase
    .from('proveedor')
    .select('id')
    .eq('id', proveedorId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!proveedor) {
    return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });
  }

  const sp = body.storage_path;
  if (sp != null && sp !== '' && !sp.startsWith(`${tenantId}/`)) {
    return NextResponse.json({ error: 'Ruta de archivo inválida' }, { status: 400 });
  }

  const dRaw = body.descuento_proveedor_pct;
  const d =
    dRaw === undefined || dRaw === null
      ? 0
      : typeof dRaw === 'number'
        ? dRaw
        : Number(dRaw);
  if (!Number.isFinite(d) || d < 0 || d >= 100) {
    return NextResponse.json(
      { error: 'descuento_proveedor_pct debe ser un número entre 0 y 99.99' },
      { status: 400 },
    );
  }
  const pctCarga = round2(Math.min(99.99, Math.max(0, d)));

  let lista;
  try {
    lista = await crearListaConItems(supabase, {
      tenantId,
      userId,
      sucursalOperativaId: sucursalScope.sucursalId ?? null,
      proveedorId,
      nombreArchivo: body.nombre_archivo,
      mimeType: body.mime_type,
      items: body.items,
      origen: body.origen,
      storagePath: sp ?? null,
      fechaVigenciaDesde: body.fecha_vigencia_desde ?? null,
      fechaVigenciaHasta: body.fecha_vigencia_hasta ?? null,
      descuentoProveedorPctCarga: pctCarga,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Error al guardar la lista' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { lista, total_items: body.items.length },
    { status: 201 },
  );
}
