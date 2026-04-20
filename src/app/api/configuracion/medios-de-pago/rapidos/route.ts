import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor, rejectUnlessAdmin } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

const CODIGOS = ['efectivo', 'debito', 'credito', 'transferencia', 'mixto'] as const;
export type CodigoMedioRapido = (typeof CODIGOS)[number];

const DEFAULTS: Record<CodigoMedioRapido, number> = {
  efectivo: 0,
  debito: 0,
  credito: 0,
  transferencia: 0,
  mixto: 0,
};

function parsePct(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function GET() {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { data, error } = await session.supabase
    .from('medio_pago_rapido')
    .select('codigo, recargo_porcentaje')
    .eq('tenant_id', session.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rapidos = { ...DEFAULTS } as Record<CodigoMedioRapido, number>;
  for (const row of data ?? []) {
    const c = row.codigo as CodigoMedioRapido;
    if (c in rapidos) {
      rapidos[c] = Number(row.recargo_porcentaje);
    }
  }

  return NextResponse.json({ rapidos });
}

export async function PUT(request: Request) {
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

  const rows: { tenant_id: string; codigo: string; recargo_porcentaje: number }[] = [];

  for (const codigo of CODIGOS) {
    const pct = parsePct(b[codigo]);
    if (pct === null) {
      return NextResponse.json({ error: `Porcentaje inválido para ${codigo}` }, { status: 400 });
    }
    rows.push({
      tenant_id: session.tenantId,
      codigo,
      recargo_porcentaje: pct,
    });
  }

  const { error: delErr } = await session.supabase
    .from('medio_pago_rapido')
    .delete()
    .eq('tenant_id', session.tenantId);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const toInsert = rows.filter((r) => r.recargo_porcentaje !== 0);
  if (toInsert.length > 0) {
    const { error: insErr } = await session.supabase.from('medio_pago_rapido').insert(toInsert);
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  const { data, error } = await session.supabase
    .from('medio_pago_rapido')
    .select('codigo, recargo_porcentaje')
    .eq('tenant_id', session.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rapidos = { ...DEFAULTS } as Record<CodigoMedioRapido, number>;
  for (const row of data ?? []) {
    const c = row.codigo as CodigoMedioRapido;
    if (c in rapidos) {
      rapidos[c] = Number(row.recargo_porcentaje);
    }
  }

  return NextResponse.json({ rapidos });
}
