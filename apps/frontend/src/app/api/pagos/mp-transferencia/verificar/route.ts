import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { MpTransferenciaClientError } from '@/lib/mp-transferencia/client';
import {
  loadMpTransferenciaAccessToken,
  verificarTransferenciaMp,
} from '@/lib/mp-transferencia/service';
import { moduloGuard } from '@/lib/modulos/guard';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: { comprobante_id?: string };
  try {
    body = (await request.json()) as { comprobante_id?: string };
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const comprobanteId = body.comprobante_id?.trim();
  if (!comprobanteId) {
    return NextResponse.json({ error: 'comprobante_id es obligatorio' }, { status: 400 });
  }

  const adminDb = createServiceRoleClient();
  const { data: comp, error: compErr } = await adminDb
    .from('comprobante')
    .select('id, tenant_id, sucursal_id, caja_id, estado, total')
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (compErr || !comp) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (!comp.sucursal_id) {
    return NextResponse.json({ error: 'El comprobante no tiene sucursal asociada' }, { status: 400 });
  }
  if (!comp.caja_id) {
    return NextResponse.json({ error: 'El comprobante no tiene caja asociada' }, { status: 400 });
  }
  if (comp.estado !== 'pendiente_transferencia_mp') {
    return NextResponse.json(
      { error: 'El comprobante no esta esperando verificacion de Transferencia MP' },
      { status: 400 },
    );
  }

  const token = await loadMpTransferenciaAccessToken(adminDb, {
    tenantId: session.tenantId,
    sucursalId: String(comp.sucursal_id),
    cajaId: String(comp.caja_id),
  });
  if (!token.ok) {
    return NextResponse.json({ error: token.error }, { status: token.status });
  }

  try {
    const result = await verificarTransferenciaMp(adminDb, {
      tenantId: session.tenantId,
      sucursalId: String(comp.sucursal_id),
      comprobanteId,
      total: Number(comp.total),
      accessToken: token.token,
    });
    return NextResponse.json({ comprobante_id: comprobanteId, ...result });
  } catch (e) {
    if (e instanceof MpTransferenciaClientError) {
      const status = e.status === 401 ? 400 : e.status >= 500 ? 503 : 400;
      console.error('[mp-transferencia verificar] Mercado Pago', {
        comprobante_id: comprobanteId,
        tenant_id: session.tenantId,
        sucursal_id: comp.sucursal_id,
        mp_status: e.status,
        mp_message: e.message,
        mp_details: e.details ?? null,
      });
      return NextResponse.json(
        {
          estado: 'error',
          error: e.message,
          mp_status: e.status,
          mp_details: e.details ?? null,
        },
        { status },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[mp-transferencia verificar]', {
      comprobante_id: comprobanteId,
      tenant_id: session.tenantId,
      sucursal_id: comp.sucursal_id,
      error: msg,
    });
    return NextResponse.json(
      { estado: 'error', error: msg || 'No se pudo verificar Transferencia MP' },
      { status: 503 },
    );
  }
}
