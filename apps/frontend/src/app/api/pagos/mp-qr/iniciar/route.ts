import { NextResponse } from 'next/server';

import { buildPublicAppAbsoluteUrl } from '@/lib/supabase/env-keys';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { getMpQrClient, MpQrError } from '@/lib/mp-qr/client';
import { decryptMpQrAccessToken, loadMpQrConfig } from '@/lib/mp-qr/load-config';
import { resolveMpQrPos } from '@/lib/mp-qr/verificar-configuracion';
import { moduloGuard } from '@/lib/modulos/guard';

function redondearPesos(n: number): number {
  return Math.round(n * 100) / 100;
}

function mpQrLegacyEndpointDebug(params: {
  userId: string;
  externalPosId: string;
  externalStoreId?: string | null;
}): { endpoint_kind: string; endpoint_path: string } {
  const uid = encodeURIComponent(params.userId.trim());
  const pos = encodeURIComponent(params.externalPosId.trim());
  const store = params.externalStoreId?.trim();
  if (store) {
    return {
      endpoint_kind: 'instore_order_with_store',
      endpoint_path: `/instore/qr/seller/collectors/${uid}/stores/${encodeURIComponent(store)}/pos/${pos}/orders`,
    };
  }
  return {
    endpoint_kind: 'dynamic_qr_without_store',
    endpoint_path: `/instore/orders/qr/seller/collectors/${uid}/pos/${pos}/qrs`,
  };
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: { comprobante_id?: string; total?: number };
  try {
    body = (await request.json()) as { comprobante_id?: string; total?: number };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const comprobanteId = body.comprobante_id?.trim();
  const total = body.total;
  if (!comprobanteId || total == null || !Number.isFinite(total) || total <= 0) {
    return NextResponse.json(
      { error: 'comprobante_id y total positivo son obligatorios' },
      { status: 400 },
    );
  }

  const { data: comp, error: compErr } = await session.supabase
    .from('comprobante')
    .select('id, tenant_id, sucursal_id, estado, numero_orden, total')
    .eq('id', comprobanteId)
    .maybeSingle();

  if (compErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (comp.estado !== 'borrador' && comp.estado !== 'pendiente_qr') {
    return NextResponse.json(
      { error: 'Solo se puede cobrar con QR sobre un borrador o un cobro QR en curso.' },
      { status: 400 },
    );
  }

  const totalDb = Number(comp.total);
  if (!Number.isFinite(totalDb) || totalDb <= 0) {
    return NextResponse.json(
      { error: 'El borrador no tiene un total valido para cobrar con QR' },
      { status: 400 },
    );
  }

  const centsCliente = Math.round(total * 100);
  const centsDb = Math.round(totalDb * 100);
  if (Math.abs(centsCliente - centsDb) > 2) {
    console.warn('[mp-qr iniciar] total body distinto del borrador', {
      comprobante_id: comprobanteId,
      tenant_id: session.tenantId,
      total_en_body: total,
      total_en_comprobante: totalDb,
      diferencia_centavos: centsCliente - centsDb,
    });
  }

  const { data: cfg, error: cfgErr } = await loadMpQrConfig(session.supabase, session.tenantId, comp.sucursal_id);
  if (cfgErr) {
    return NextResponse.json({ error: cfgErr }, { status: 500 });
  }
  if (!cfg?.habilitado || !cfg.access_token || !cfg.user_id?.trim() || !cfg.external_pos_id?.trim()) {
    return NextResponse.json({ error: 'Configuración de MP QR incompleta' }, { status: 400 });
  }

  const tokenPlain = decryptMpQrAccessToken(cfg.access_token);
  if (!tokenPlain) {
    return NextResponse.json({ error: 'Configuración de MP QR incompleta' }, { status: 400 });
  }

  const { data: tenantRow } = await session.supabase
    .from('tenant')
    .select('nombre')
    .eq('id', session.tenantId)
    .maybeSingle();
  const tenantNombre =
    typeof tenantRow?.nombre === 'string' && tenantRow.nombre.trim() ? tenantRow.nombre.trim() : 'Comercio';

  const userId = cfg.user_id.trim();
  const resolvedPos = await resolveMpQrPos({
    access_token: tokenPlain,
    user_id: userId,
    external_pos_id: cfg.external_pos_id.trim(),
  }).catch(() => ({
    external_pos_id: cfg.external_pos_id!.trim(),
    external_store_id: null,
    resolved_from_internal_id: false,
  }));
  const externalPosId = resolvedPos.external_pos_id;
  const externalStoreId = resolvedPos.external_store_id;
  if (resolvedPos.resolved_from_internal_id) {
    console.info('[mp-qr iniciar] external_pos_id resuelto desde id interno de MP', {
      comprobante_id: comprobanteId,
      external_pos_id_config: cfg.external_pos_id.trim(),
      external_pos_id_usado: externalPosId,
    });
  }
  const client = getMpQrClient(tokenPlain, userId);
  const totalPesos = redondearPesos(totalDb);

  if (comp.estado === 'pendiente_qr') {
    try {
      await client.cancelOrder(externalPosId, { externalStoreId });
    } catch (e) {
      if (e instanceof MpQrError && (e.status === 404 || e.status === 422)) {
        /* sin orden activa */
      } else if (e instanceof MpQrError) {
        console.error('[mp-qr iniciar] cancel prev', e.status, e.code);
      }
    }
  }

  const notificationUrl = buildPublicAppAbsoluteUrl(
    `/api/pagos/mp-qr/webhook?tenant_id=${encodeURIComponent(session.tenantId)}&sucursal_id=${encodeURIComponent(String(comp.sucursal_id))}`,
  );
  if (!notificationUrl) {
    return NextResponse.json(
      {
        error:
          'No se pudo armar la URL del webhook para Mercado Pago. Revisá NEXT_PUBLIC_SITE_URL o NEXT_PUBLIC_APP_URL: tiene que ser una URL absoluta válida (por ejemplo https://tu-dominio.com). Si solo pusiste el dominio sin https://, probá agregarlo.',
      },
      { status: 400 },
    );
  }

  const title = `Venta #${comp.numero_orden}`;
  const orderDescription = `Venta #${comp.numero_orden} - ${tenantNombre}`;
  const itemDescription = 'Cobro POS Nexus';
  const payload = {
    external_reference: comprobanteId,
    title,
    description: orderDescription,
    notification_url: notificationUrl,
    total_amount: totalPesos,
    items: [
      {
        title,
        description: itemDescription,
        unit_price: totalPesos,
        quantity: 1,
        unit_measure: 'unit' as const,
        total_amount: totalPesos,
      },
    ],
  };
  const requestPayload = {
    proveedor: 'mercado_pago',
    tipo: 'mp_qr_legacy',
    tenant_id: session.tenantId,
    sucursal_id: comp.sucursal_id,
    comprobante_id: comprobanteId,
    external_pos_id_configurado: cfg.external_pos_id.trim(),
    external_pos_id_usado: externalPosId,
    external_store_id: externalStoreId ?? null,
    resolved_from_internal_id: resolvedPos.resolved_from_internal_id,
    ...mpQrLegacyEndpointDebug({
      userId,
      externalPosId,
      externalStoreId,
    }),
    payload,
  };

  try {
    console.info('[mp-qr iniciar] create order request', requestPayload);
    await client.createOrder(externalPosId, payload, { externalStoreId });

    const { error: upErr } = await session.supabase
      .from('comprobante')
      .update({
        estado: 'pendiente_qr' as never,
        mp_qr_cancelado_at: null,
        mp_qr_pago_huerfano: false,
      })
      .eq('id', comprobanteId)
      .eq('tenant_id', session.tenantId);

    if (upErr) {
      console.error('[mp-qr iniciar] DB', upErr);
      try {
        await client.cancelOrder(externalPosId, { externalStoreId });
      } catch {
        /* noop */
      }
      return NextResponse.json({ error: 'No se pudo guardar el estado del comprobante' }, { status: 500 });
    }

    return NextResponse.json({
      estado: 'pendiente_qr',
      monto_terminal_pesos: totalPesos,
    });
  } catch (e) {
    if (e instanceof MpQrError) {
      console.error('[mp-qr iniciar] create order failed', {
        ...requestPayload,
        mp_status: e.status,
        mp_code: e.code,
        mp_message: e.message,
        mp_details: e.details ?? null,
      });
      if (e.status === 401) {
        return NextResponse.json({ error: 'Token de MP inválido o vencido', mp_error_code: e.code }, { status: 400 });
      }
      if (e.status === 409 || /orden activa|in_use|occupied/i.test(e.message)) {
        return NextResponse.json(
          { error: 'Hay una venta en curso en esta caja, esperá o cancelala' },
          { status: 409 },
        );
      }
      const st = e.status >= 500 ? 503 : 503;
      return NextResponse.json(
        { error: e.message || 'Error de Mercado Pago QR', mp_error_code: e.code },
        { status: st },
      );
    }
    console.error('[mp-qr iniciar]', e);
    return NextResponse.json({ error: 'Error al iniciar cobro QR' }, { status: 503 });
  }
}
