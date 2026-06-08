import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';

export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { data: tenant, error } = await session.supabase
    .from('tenant')
    .select('plan, ia_ilimitada_origen')
    .eq('id', session.tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    plan: tenant?.plan ?? 'base',
    ia_ilimitada_origen: tenant?.ia_ilimitada_origen ?? null,
  });
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { data: usuario } = await session.supabase
    .from('usuario')
    .select('rol')
    .eq('id', session.userId)
    .maybeSingle();

  if (!usuario || usuario.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo el administrador puede cambiar esta configuración' }, { status: 403 });
  }

  const { data: tenant, error: tenantErr } = await session.supabase
    .from('tenant')
    .select('plan')
    .eq('id', session.tenantId)
    .maybeSingle();

  if (tenantErr) return NextResponse.json({ error: tenantErr.message }, { status: 500 });
  if ((tenant?.plan ?? 'base') !== 'intermedio') {
    return NextResponse.json(
      { error: 'La IA ilimitada a elección solo está disponible en el plan intermedio.' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const rawOrigen = b?.ia_ilimitada_origen;
  const origen = rawOrigen === 'lector_factura' || rawOrigen === 'ia_pdf' ? rawOrigen : null;

  if (!origen) {
    return NextResponse.json(
      { error: 'Valor inválido. Usá "lector_factura" o "ia_pdf".' },
      { status: 400 },
    );
  }

  const { error } = await session.supabase
    .from('tenant')
    .update({ ia_ilimitada_origen: origen })
    .eq('id', session.tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, ia_ilimitada_origen: origen });
}

