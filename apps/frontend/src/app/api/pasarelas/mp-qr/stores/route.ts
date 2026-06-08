import { NextResponse } from 'next/server';

import { puedeGestionarEstructuraCajas } from '@/lib/api/cajas-config-permissions';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import {
  getMpQrAccountInfo,
  listMpQrStores,
  MpQrSetupError,
} from '@/lib/mp-qr/setup';

async function assertGestionable() {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return { ok: false as const, response: guard.response };

  const session = await getTenantSession();
  if ('error' in session) return { ok: false as const, response: session.error };

  if (!(await puedeGestionarEstructuraCajas(session))) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Sin permisos para gestionar pasarelas.' }, { status: 403 }),
    };
  }

  return { ok: true as const };
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorResponse(error: unknown) {
  if (error instanceof MpQrSetupError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status >= 500 ? 503 : error.status },
    );
  }
  console.error('[mp-qr/stores]', error);
  return NextResponse.json({ error: 'No se pudieron cargar los locales de Mercado Pago' }, { status: 503 });
}

export async function POST(request: Request) {
  const resolved = await assertGestionable();
  if (!resolved.ok) return resolved.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = cleanString(body.access_token) || cleanString(body.api_key);
  if (!accessToken) return NextResponse.json({ error: 'access_token es obligatorio' }, { status: 400 });

  try {
    const account = await getMpQrAccountInfo(accessToken);
    const stores = await listMpQrStores(accessToken, account.id);
    return NextResponse.json({ user: account, stores });
  } catch (error) {
    return errorResponse(error);
  }
}
