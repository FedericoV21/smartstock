import { NextResponse, type NextRequest } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';

const MAX_RESULTS = 40;

export async function GET(request: NextRequest) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { supabase, tenantId } = session;

  const { data: modCfg } = await supabase
    .from('modulo_config')
    .select('facturador_pos')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!modCfg?.facturador_pos) {
    return NextResponse.json(
      { error: "El módulo 'facturador_pos' no está habilitado para tu plan." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('q')?.trim() ?? '';

  if (!raw) {
    return NextResponse.json({ productos: [] });
  }

  // Sanitize for ilike inside PostgREST .or(): strip chars with special
  // meaning in the filter syntax (,()) or in SQL LIKE (% _ \).
  const q = raw.replace(/[,()%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) {
    return NextResponse.json({ productos: [] });
  }

  const isNumeric = /^\d+$/.test(q);

  let query = supabase
    .from('producto')
    .select(
      'id, codigo, nombre, precio_venta, stock_actual, unidad, es_pesable, codigo_barras, iva_porcentaje',
    )
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .order('nombre')
    .limit(MAX_RESULTS);

  if (isNumeric) {
    query = query.or(
      `codigo_barras.eq.${q},codigo.ilike.%${q}%,nombre.ilike.%${q}%,plu.eq.${q}`,
    );
  } else {
    query = query.or(`nombre.ilike.%${q}%,codigo.ilike.%${q}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ productos: data ?? [] });
}
