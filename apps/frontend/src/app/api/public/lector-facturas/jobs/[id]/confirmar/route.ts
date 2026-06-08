import { NextResponse } from 'next/server';

import { authenticateApiIntegrationKey } from '@/lib/api-integraciones/keys';
import {
  aplicarConfirmacionLectorFacturaJob,
  prepararConfirmacionLectorFacturaDesdeResultado,
  type LectorFacturaConfirmacionOverrides,
} from '@/lib/lector-facturas/confirmacion-chatbot';
import { parsePagoProveedorField } from '@/lib/lector-facturas/ejecutar-confirmacion-importado';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...(extra ?? {}) }, { status });
}

function boolOverride(raw: Record<string, unknown>, key: keyof LectorFacturaConfirmacionOverrides) {
  return typeof raw[key] === 'boolean' ? raw[key] as boolean : undefined;
}

function parseOverrides(raw: Record<string, unknown>): { ok: true; value: LectorFacturaConfirmacionOverrides } | { ok: false; error: string } {
  const overrides: LectorFacturaConfirmacionOverrides = {};
  const actualizarCostos = boolOverride(raw, 'actualizar_costos');
  const afectaStock = boolOverride(raw, 'afecta_stock');
  const afectaCuentaCorriente = boolOverride(raw, 'afecta_cuenta_corriente');
  const preciosItemsConIvaIncluido = boolOverride(raw, 'precios_items_con_iva_incluido');
  if (actualizarCostos !== undefined) overrides.actualizar_costos = actualizarCostos;
  if (afectaStock !== undefined) overrides.afecta_stock = afectaStock;
  if (afectaCuentaCorriente !== undefined) overrides.afecta_cuenta_corriente = afectaCuentaCorriente;
  if (preciosItemsConIvaIncluido !== undefined) {
    overrides.precios_items_con_iva_incluido = preciosItemsConIvaIncluido;
  }
  if ('pago' in raw) {
    const pago = parsePagoProveedorField(raw.pago);
    if (raw.pago != null && pago == null) return { ok: false, error: 'Campo pago invalido' };
    overrides.pago = pago;
  }
  return { ok: true, value: overrides };
}

export async function POST(request: Request, ctx: RouteParams) {
  if (!getSupabaseServiceRoleKey()) {
    return jsonError('Service role key no configurada', 503);
  }

  const { id } = await ctx.params;
  const jobId = id?.trim();
  if (!jobId) return jsonError('job_id requerido', 400);

  const db = createServiceRoleClient() as any;
  const auth = await authenticateApiIntegrationKey({
    db,
    request,
    scope: 'lector_facturas:jobs:confirm',
  });
  if (!auth.ok) return jsonError(auth.error, auth.status);

  let raw: Record<string, unknown>;
  try {
    const parsed = await request.json();
    raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return jsonError('Body invalido', 400);
  }

  const overrides = parseOverrides(raw);
  if (!overrides.ok) return jsonError(overrides.error, 400);

  const { data: job, error } = await db
    .from('lector_factura_job')
    .select(
      'id, tenant_id, sucursal_id, usuario_id, api_key_id, status, resultado, application_status, applied_comprobante_id',
    )
    .eq('id', jobId)
    .eq('tenant_id', auth.tenantId)
    .eq('api_key_id', auth.key.id)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!job?.id) return jsonError('Job no encontrado', 404);
  if (job.status !== 'completed') return jsonError('El job todavia no esta completado.', 409);

  const sucursalId = job.sucursal_id ?? auth.sucursalId;
  const userId = job.usuario_id ?? auth.userId;
  const acceptedImpactHash = typeof raw.accepted_impact_hash === 'string' ? raw.accepted_impact_hash.trim() : '';
  const confirmed = raw.confirm === true;

  if (!confirmed || !acceptedImpactHash) {
    const prepared = await prepararConfirmacionLectorFacturaDesdeResultado({
      db,
      tenantId: auth.tenantId,
      sucursalId,
      resultado: job.resultado,
      overrides: overrides.value,
    });
    await db
      .from('lector_factura_job')
      .update({
        impacto_preview: prepared.impacto,
        impact_hash: prepared.impactHash,
        confirm_payload: prepared.confirmPayload,
        application_status: prepared.impacto.bloqueantes.length > 0 ? 'blocked' : 'pending',
        applied_error:
          prepared.impacto.bloqueantes.length > 0 ? prepared.impacto.bloqueantes.join(' | ') : null,
      })
      .eq('id', job.id)
      .eq('tenant_id', auth.tenantId);

    return jsonError('Confirmacion requerida con confirm=true y accepted_impact_hash.', 428, {
      impacto: prepared.impacto,
      impact_hash: prepared.impactHash,
    });
  }

  const applied = await aplicarConfirmacionLectorFacturaJob({
    db,
    tenantId: auth.tenantId,
    job,
    sucursalId,
    userId,
    acceptedImpactHash,
    overrides: overrides.value,
  });

  if (!applied.ok) {
    return jsonError(applied.error, applied.status, {
      impacto: applied.impacto,
      impact_hash: applied.impact_hash,
      bloqueantes: applied.bloqueantes,
    });
  }

  return NextResponse.json({
    comprobante_id: applied.comprobante_id,
    actualizaciones_costos: applied.actualizaciones_costos,
    impacto: applied.impacto,
    impact_hash: applied.impact_hash,
    idempotent_replay: applied.idempotent_replay,
  });
}
