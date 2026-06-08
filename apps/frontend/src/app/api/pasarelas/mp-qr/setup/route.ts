import { NextResponse } from 'next/server';

import { puedeGestionarEstructuraCajas } from '@/lib/api/cajas-config-permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { prepareMpQrNexusSetup, MpQrSetupError } from '@/lib/mp-qr/setup';
import { getPasarelaAdapter } from '@/lib/pasarelas/adapters';
import { encryptSecretsRecord, sanitizeIntegracion } from '@/lib/pasarelas/secrets';
import type { PasarelaEstado, PasarelaIntegracionRow } from '@/lib/pasarelas/types';

const ESTADOS: PasarelaEstado[] = ['activa', 'inactiva', 'incompleta'];
const MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY = 'mp_transferencia_habilitada';

type PasarelaInsertResult = {
  data: (PasarelaIntegracionRow & { secretos_cifrados?: unknown }) | null;
  error: { message: string } | null;
};

type PasarelaDb = {
  from(table: 'pasarela_integracion'): {
    insert(row: unknown): {
      select(columns: string): {
        single(): Promise<PasarelaInsertResult>;
      };
    };
  };
};

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

  return { ok: true as const, session, db: session.supabase as unknown as PasarelaDb };
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNombre(value: unknown): string {
  return (typeof value === 'string' ? value.trim() : '').slice(0, 120) || 'Mercado Pago QR';
}

function cleanEstado(value: unknown): PasarelaEstado {
  return ESTADOS.includes(value as PasarelaEstado) ? (value as PasarelaEstado) : 'activa';
}

function cleanBoolean(value: unknown): boolean {
  return value === true;
}

function errorResponse(error: unknown) {
  if (error instanceof MpQrSetupError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status >= 500 ? 503 : error.status },
    );
  }
  console.error('[mp-qr/setup]', error);
  return NextResponse.json({ error: 'No se pudo preparar Mercado Pago QR' }, { status: 503 });
}

export async function POST(request: Request) {
  const resolved = await assertGestionable();
  if (!resolved.ok) return resolved.response;
  const { session, db } = resolved;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const scope = await resolveAndValidateSucursalScope(session, cleanString(body.sucursal_id));
  if (!scope.ok) return scope.response;
  if (!scope.sucursalId) {
    return NextResponse.json({ error: 'sucursal_id es obligatorio' }, { status: 400 });
  }

  const accessToken = cleanString(body.access_token) || cleanString(body.api_key);
  const storeId = cleanString(body.store_id);
  if (!accessToken) return NextResponse.json({ error: 'access_token es obligatorio' }, { status: 400 });
  if (!storeId) return NextResponse.json({ error: 'store_id es obligatorio' }, { status: 400 });

  try {
    const setup = await prepareMpQrNexusSetup({ accessToken, storeId });
    const configPublica = {
      user_id: setup.account.id,
      external_pos_id: setup.pos.external_id,
      external_store_id: setup.external_store_id,
      mp_store_id: setup.store.id,
      mp_store_name: setup.store.name,
      mp_pos_id: setup.pos.id,
      mp_pos_name: setup.pos.name,
      [MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY]: cleanBoolean(
        body[MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY],
      ),
    };
    const secretos: Record<string, string> = { access_token: accessToken };
    const webhookSecret = cleanString(body.webhook_secret) || cleanString(body.webhook_id);
    if (webhookSecret) secretos.webhook_secret = webhookSecret;

    const row = {
      tenant_id: session.tenantId,
      sucursal_id: scope.sucursalId,
      proveedor: 'mercado_pago',
      canal: 'qr' as const,
      tipo: 'mp_qr',
      nombre: cleanNombre(body.nombre),
      estado: cleanEstado(body.estado),
      config_publica: configPublica,
      secretos_cifrados: encryptSecretsRecord(secretos),
    };

    const adapter = getPasarelaAdapter('mp_qr');
    if (row.estado === 'activa' && adapter) {
      const validationRow: PasarelaIntegracionRow = {
        ...row,
        id: '',
        webhook_public_id: '',
      };
      const validation = adapter.validateConfig(validationRow);
      if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { data, error } = await db.from('pasarela_integracion').insert(row).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: 'No se pudo crear la integracion' }, { status: 500 });

    return NextResponse.json(
      {
        integracion: sanitizeIntegracion(data),
        mp: setup,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
