import { NextResponse } from 'next/server';

import { authenticateApiIntegrationKey } from '@/lib/api-integraciones/keys';
import { prepararConfirmacionLectorFacturaDesdeResultado } from '@/lib/lector-facturas/confirmacion-chatbot';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(request: Request, ctx: RouteParams) {
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
    scope: 'lector_facturas:jobs:read',
  });
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const { data, error } = await db
    .from('lector_factura_job')
    .select(
      'id, status, external_id, sucursal_id, lector_factura_log_id, resultado, error_code, error_detail, application_status, impacto_preview, impact_hash, confirm_payload, applied_comprobante_id, applied_at, applied_error, created_at, started_at, finished_at',
    )
    .eq('id', jobId)
    .eq('tenant_id', auth.tenantId)
    .eq('api_key_id', auth.key.id)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!data?.id) return jsonError('Job no encontrado', 404);

  let impacto = data.impacto_preview ?? null;
  let impactHash = data.impact_hash ?? null;
  if (data.status === 'completed' && data.resultado && (!impacto || !impactHash)) {
    try {
      const prepared = await prepararConfirmacionLectorFacturaDesdeResultado({
        db,
        tenantId: auth.tenantId,
        sucursalId: data.sucursal_id ?? auth.sucursalId,
        resultado: data.resultado,
      });
      impacto = prepared.impacto;
      impactHash = prepared.impactHash;
      await db
        .from('lector_factura_job')
        .update({
          impacto_preview: prepared.impacto,
          impact_hash: prepared.impactHash,
          confirm_payload: prepared.confirmPayload,
          application_status:
            prepared.impacto.bloqueantes.length > 0 ? 'blocked' : data.application_status ?? 'pending',
          applied_error:
            prepared.impacto.bloqueantes.length > 0 ? prepared.impacto.bloqueantes.join(' | ') : null,
        })
        .eq('id', data.id)
        .eq('tenant_id', auth.tenantId);
    } catch (e) {
      return jsonError((e as Error).message, 500);
    }
  }

  return NextResponse.json({
    job_id: data.id,
    status: data.status,
    external_id: data.external_id,
    log_id: data.lector_factura_log_id,
    result: data.status === 'completed' ? data.resultado : null,
    impacto: data.status === 'completed' ? impacto : null,
    impact_hash: data.status === 'completed' ? impactHash : null,
    application_status: data.application_status,
    applied_comprobante_id: data.applied_comprobante_id,
    applied_at: data.applied_at,
    applied_error: data.applied_error,
    error:
      data.status === 'failed'
        ? {
            code: data.error_code,
            message: data.error_detail,
          }
        : null,
    created_at: data.created_at,
    started_at: data.started_at,
    finished_at: data.finished_at,
  });
}
