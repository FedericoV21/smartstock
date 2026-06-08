import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { emitirReciboTrasPagoCobranza } from '@/lib/cobranza/emitir-recibo-pago';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

type TipoPago = Database['public']['Enums']['tipo_pago'];

type RpcPagoCobranzaResult = {
  cobranza_pago_id?: string;
  nuevo_saldo?: number;
  pago_cuenta_corriente_id?: string;
  monto_aplicado?: number;
  saldo_a_favor_generado?: number;
};

/** Registra un cobro parcial o total contra la factura (cuenta corriente + historial + recibo PDF). */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const { id: cobranzaFacturaId } = await ctx.params;

  let body: {
    monto?: number;
    tipo_pago?: TipoPago;
    notas?: string | null;
    /** Si es `false`, no se genera el comprobante `recibo` (solo cobro). Por defecto `true`. */
    emitir_recibo?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const monto = Number(body.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json({ error: 'monto debe ser un número mayor a cero' }, { status: 400 });
  }

  const { data: cobRow, error: cobLoadErr } = await session.supabase
    .from('cobranza_factura')
    .select('cliente_id, saldo_pendiente')
    .eq('id', cobranzaFacturaId)
    .maybeSingle();

  if (cobLoadErr || !cobRow) {
    return NextResponse.json(
      { error: cobLoadErr?.message ?? 'Cobranza no encontrada' },
      { status: cobLoadErr ? 500 : 404 },
    );
  }

  const { data: cuentaCc } = await session.supabase
    .from('cuenta_corriente')
    .select('cobro_monto_minimo')
    .eq('cliente_id', cobRow.cliente_id)
    .maybeSingle();

  const minimo = cuentaCc?.cobro_monto_minimo ?? 0;
  const saldoPend = Number(cobRow.saldo_pendiente);
  if (minimo > 0 && monto < minimo) {
    const tol = 0.01;
    const esLiquidacion = monto + tol >= saldoPend;
    if (!esLiquidacion) {
      return NextResponse.json(
        {
          error: `El monto no puede ser menor al mínimo acordado (${minimo}) salvo liquidar el saldo total (${saldoPend}).`,
        },
        { status: 400 },
      );
    }
  }

  const tipoPago = body.tipo_pago ?? 'efectivo';
  const emitirRecibo = body.emitir_recibo !== false;

  const { data, error } = await session.supabase.rpc('registrar_pago_cobranza', {
    p_cobranza_factura_id: cobranzaFacturaId,
    p_monto: monto,
    p_tipo_pago: tipoPago,
    p_notas: body.notas ?? null,
    p_usuario_id: session.userId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('supera el saldo')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const resultado = data as RpcPagoCobranzaResult | null;
  const cobranzaPagoId = resultado?.cobranza_pago_id;

  let recibo:
    | { id: string; pdf_url: string | null }
    | null = null;
  let recibo_error: string | null = null;

  if (emitirRecibo && cobranzaPagoId) {
    const { data: cob, error: cobErr } = await session.supabase
      .from('cobranza_factura')
      .select('cliente_id, comprobante_id')
      .eq('id', cobranzaFacturaId)
      .maybeSingle();

    if (cobErr || !cob) {
      recibo_error = 'No se pudo cargar la cobranza para emitir el recibo.';
    } else {
      const rec = await emitirReciboTrasPagoCobranza(session.supabase, {
        tenantId: session.tenantId,
        userId: session.userId,
      }, {
        clienteId: cob.cliente_id,
        monto,
        cobranzaPagoId,
        comprobanteFacturaId: cob.comprobante_id,
        tipoPago,
        notasCobro: body.notas ?? null,
      });
      if (rec.ok) {
        recibo = { id: rec.comprobanteId, pdf_url: rec.pdfUrl };
      } else {
        recibo_error = rec.error;
      }
    }
  }

  return NextResponse.json({ resultado: data, recibo, recibo_error });
}
