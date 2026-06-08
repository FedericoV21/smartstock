import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getMpPointClient, MpPointError } from '@/lib/mp-point/client';
import { decryptAccessToken, loadMpPointConfig } from '@/lib/mp-point/load-config';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: Request) {
  const posGuard = await moduloGuard('facturador_pos');
  if (!posGuard.allowed) return posGuard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const url = new URL(request.url);
  const sucursalScope = await resolveAndValidateSucursalScope(session, url.searchParams.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;

  const { data: mod } = await session.supabase
    .from('modulo_config')
    .select('facturador_pos')
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  const { data: cfg } = await loadMpPointConfig(session.supabase, session.tenantId, sucursalScope.sucursalId);

  if (!mod?.facturador_pos || !cfg || cfg.habilitado === false) {
    return NextResponse.json(
      { error: 'Mercado Pago Point no está habilitado' },
      { status: 403 },
    );
  }

  const tokenPlain = decryptAccessToken(cfg.access_token);
  if (!tokenPlain) {
    return NextResponse.json({ error: 'Token de MP no configurado' }, { status: 400 });
  }

  try {
    const client = getMpPointClient(tokenPlain);
    const devices = await client.listDevices();
    const list = devices
      .filter((d) => Boolean(String(d.id ?? '').trim()))
      .map((d) => ({
        id: d.id,
        name: d.name ?? d.external_pos_id,
        operating_mode: d.operating_mode,
        external_pos_id: d.external_pos_id,
      }));
    return NextResponse.json({ devices: list });
  } catch (e) {
    if (e instanceof MpPointError) {
      if (e.status === 401) {
        return NextResponse.json(
          { error: 'Token de MP inválido o vencido' },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: e.message, mp_error_code: e.code },
        { status: e.status >= 500 ? 503 : 400 },
      );
    }
    console.error('[GET /api/pagos/mp-point/devices]', e);
    return NextResponse.json({ error: 'Error al consultar terminales' }, { status: 503 });
  }
}
