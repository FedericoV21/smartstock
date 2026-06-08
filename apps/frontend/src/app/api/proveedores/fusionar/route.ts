import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { rejectUnlessProveedorEdicion } from '@/lib/api/permissions';
import { moduloGuard } from '@/lib/modulos/guard';

function parseUuidList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string' || !/^[0-9a-f-]{36}$/i.test(x)) return null;
    out.push(x);
  }
  return out;
}

export async function POST(request: Request) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const deniedProv = await rejectUnlessProveedorEdicion(session.supabase, session);
  if (deniedProv) return deniedProv;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const survivorRaw = b.survivor_id;
  const survivorId =
    typeof survivorRaw === 'string' && /^[0-9a-f-]{36}$/i.test(survivorRaw) ? survivorRaw : null;
  if (!survivorId) {
    return NextResponse.json({ error: 'survivor_id inválido' }, { status: 400 });
  }

  const loserIds = parseUuidList(b.loser_ids);
  if (!loserIds || loserIds.length === 0) {
    return NextResponse.json({ error: 'loser_ids debe ser un array de UUID no vacío' }, { status: 400 });
  }

  const distinctLosers = [...new Set(loserIds)];
  if (distinctLosers.includes(survivorId)) {
    return NextResponse.json(
      { error: 'El proveedor destino no puede figurar entre los fusionados' },
      { status: 400 },
    );
  }

  const dryRun = b.dry_run === true;

  const { data, error } = await session.supabase.rpc('fusionar_proveedores', {
    p_tenant_id: session.tenantId,
    p_survivor_id: survivorId,
    p_loser_ids: distinctLosers,
    p_dry_run: dryRun,
  });

  if (error) {
    const msg = error.message || 'Error al fusionar proveedores';
    const isUser = /no encontrado|distintos|autorizado|Indicá/i.test(msg);
    return NextResponse.json({ error: msg }, { status: isUser ? 400 : 500 });
  }

  return NextResponse.json(data ?? {});
}
