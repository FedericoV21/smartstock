import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { getMpTransferenciaClient, MpTransferenciaClientError } from '@/lib/mp-transferencia/client';
import {
  fechaMpTransferenciaHoy,
  loadMpTransferenciaAccessToken,
  rangoDiaArgentinaUtc,
} from '@/lib/mp-transferencia/service';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const scope = await resolveAndValidateSucursalScope(session, url.searchParams.get('sucursal_id'));
  if (!scope.ok) return scope.response;
  if (!scope.sucursalId) {
    return NextResponse.json({ ok: false, error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const token = await loadMpTransferenciaAccessToken(session.supabase, {
    tenantId: session.tenantId,
    sucursalId: scope.sucursalId,
  });
  if (!token.ok) {
    return NextResponse.json({ ok: false, error: token.error }, { status: token.status });
  }

  const client = getMpTransferenciaClient(token.token);
  try {
    const fecha = fechaMpTransferenciaHoy();
    const { beginDateIso, endDateIso } = rangoDiaArgentinaUtc(fecha);
    const pagos = await client.searchPayments({
      status: 'approved',
      limit: 5,
      offset: 0,
      sort: 'date_created',
      criteria: 'desc',
      beginDateIso,
      endDateIso,
    });
    return NextResponse.json({
      ok: true,
      token_qr_mp: 'valido',
      cuenta_pagos_mp: 'accesible',
      sucursal_id: scope.sucursalId,
      fecha,
      pagos_count: pagos.paging?.total ?? pagos.results?.length ?? 0,
      ultimos_pagos: (pagos.results ?? []).slice(0, 5).map((p) => ({
        id: p.id ?? null,
        date_created: p.date_created ?? null,
        date_approved: p.date_approved ?? null,
        status: p.status ?? null,
        status_detail: p.status_detail ?? null,
        transaction_amount: p.transaction_amount ?? null,
        currency_id: p.currency_id ?? null,
        payment_method_id: p.payment_method_id ?? null,
        payment_type_id: p.payment_type_id ?? null,
      })),
    });
  } catch (e) {
    if (e instanceof MpTransferenciaClientError) {
      console.error('[mp-transferencia diagnostico]', {
        tenant_id: session.tenantId,
        sucursal_id: scope.sucursalId,
        mp_status: e.status,
        mp_message: e.message,
        mp_details: e.details ?? null,
      });
      return NextResponse.json(
        {
          ok: false,
          token_qr_mp: e.status === 401 || e.status === 403 ? 'rechazado' : 'no_validado',
          cuenta_pagos_mp: 'no_accesible',
          error: e.message,
          mp_status: e.status,
          mp_details: e.details ?? null,
        },
        { status: e.status === 401 || e.status === 403 ? 400 : e.status >= 500 ? 503 : 400 },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[mp-transferencia diagnostico]', msg);
    return NextResponse.json(
      { ok: false, error: msg || 'No se pudo diagnosticar Mercado Pago' },
      { status: 503 },
    );
  }
}
