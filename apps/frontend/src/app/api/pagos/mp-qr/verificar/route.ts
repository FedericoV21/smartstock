import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { decryptMpQrAccessToken, loadMpQrConfig } from '@/lib/mp-qr/load-config';
import { runMpQrVerificacionMpQr } from '@/lib/mp-qr/verificar-configuracion';
import { moduloGuard } from '@/lib/modulos/guard';

interface VerificarBody {
  access_token?: string;
  user_id?: string;
  external_pos_id?: string;
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  if (session.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  const url = new URL(request.url);
  const sucursalScope = await resolveAndValidateSucursalScope(session, url.searchParams.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;

  let body: VerificarBody;
  try {
    body = (await request.json()) as VerificarBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const userId = body.user_id?.trim();
  const externalPosId = body.external_pos_id?.trim();
  if (!userId || !externalPosId) {
    return NextResponse.json(
      { error: 'user_id y external_pos_id son obligatorios' },
      { status: 400 },
    );
  }

  let accessToken = body.access_token?.trim() ?? '';
  if (!accessToken) {
    const { data: cfg } = await loadMpQrConfig(session.supabase, session.tenantId, sucursalScope.sucursalId);
    accessToken = decryptMpQrAccessToken(cfg?.access_token ?? null) ?? '';
  }
  if (!accessToken) {
    return NextResponse.json(
      {
        error:
          'access_token es obligatorio (pegá el token de producción) o guardá uno en esta pantalla antes de verificar.',
      },
      { status: 400 },
    );
  }

  const result = await runMpQrVerificacionMpQr({
    access_token: accessToken,
    user_id: userId,
    external_pos_id: externalPosId,
  });

  return NextResponse.json(result);
}
