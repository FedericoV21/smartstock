import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { buildFusionarProductoCamposPayload } from '@/lib/productos/fusionar-producto-campos';
import { moduloGuard } from '@/lib/modulos/guard';

function parseUuidListSingle(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length !== 1) return null;
  const x = raw[0];
  if (typeof x !== 'string' || !/^[0-9a-f-]{36}$/i.test(x)) return null;
  return x;
}

export async function POST(request: Request) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

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

  const loserId = parseUuidListSingle(b.loser_ids);
  if (!loserId) {
    return NextResponse.json({ error: 'loser_ids debe ser un array con un UUID' }, { status: 400 });
  }

  if (loserId === survivorId) {
    return NextResponse.json({ error: 'El destino y el origen no pueden ser el mismo producto' }, { status: 400 });
  }

  const dryRun = b.dry_run === true;

  let campos: Record<string, string>;
  try {
    campos = buildFusionarProductoCamposPayload(
      b.campos && typeof b.campos === 'object' && !Array.isArray(b.campos)
        ? (b.campos as Record<string, unknown>)
        : undefined,
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const { data, error } = await session.supabase.rpc('fusionar_productos', {
    p_tenant_id: session.tenantId,
    p_survivor_id: survivorId,
    p_loser_ids: [loserId],
    p_campos: campos,
    p_dry_run: dryRun,
  });

  if (error) {
    const msg = error.message || 'Error al fusionar productos';
    const isUser =
      /no encontrado|distintos|autorizado|Indicá|mismo|coincidir|unicidad|PLU|pesable|permitida|usar survivor/i.test(
        msg,
      );
    return NextResponse.json({ error: msg }, { status: isUser ? 400 : 500 });
  }

  return NextResponse.json(data ?? {});
}
