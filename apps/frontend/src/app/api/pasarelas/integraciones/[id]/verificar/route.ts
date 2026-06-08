import { NextResponse } from 'next/server';

import { puedeGestionarEstructuraCajas } from '@/lib/api/cajas-config-permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { getPasarelaAdapter } from '@/lib/pasarelas/adapters';
import type { PasarelaIntegracionRow, PasarelaVerificacionResult } from '@/lib/pasarelas/types';

type RouteParams = { params: Promise<{ id: string }> };

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

  return { ok: true as const, session, db: session.supabase as any };
}

function resultadoIncompleto(mensaje: string): PasarelaVerificacionResult {
  return {
    ok: false,
    mensaje,
    checks: {
      configuracion: { ok: false, mensaje },
    },
  };
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function POST(request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  const integracionId = typeof id === 'string' ? id.trim() : '';
  if (!integracionId) return NextResponse.json({ error: 'id es obligatorio' }, { status: 400 });

  const resolved = await assertGestionable();
  if (!resolved.ok) return resolved.response;
  const { session, db } = resolved;

  const { data: current, error: currentErr } = await db
    .from('pasarela_integracion')
    .select('*')
    .eq('tenant_id', session.tenantId)
    .eq('id', integracionId)
    .maybeSingle();

  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });

  const scope = await resolveAndValidateSucursalScope(session, current.sucursal_id);
  if (!scope.ok) return scope.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const integracion = {
    ...current,
    config_publica: {
      ...jsonRecord(current.config_publica),
      ...jsonRecord(body.config_publica),
    },
    secretos_cifrados: {
      ...jsonRecord(current.secretos_cifrados),
      ...jsonRecord(body.secretos),
    },
  } as PasarelaIntegracionRow;
  const adapter = getPasarelaAdapter(String(integracion.tipo));
  if (!adapter) {
    return NextResponse.json({ error: 'Tipo de pasarela no soportado' }, { status: 400 });
  }
  if (!adapter.verifyConfig) {
    return NextResponse.json({ error: 'Esta pasarela no tiene verificacion disponible' }, { status: 400 });
  }

  const validation = adapter.validateConfig(integracion);
  if (!validation.ok) {
    return NextResponse.json(resultadoIncompleto(validation.error));
  }

  const result = await adapter.verifyConfig({
    db,
    tenantId: session.tenantId,
    integracion,
  });
  return NextResponse.json(result);
}
