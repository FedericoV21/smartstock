import { NextResponse } from 'next/server';

import { ETIQUETA_ESTADO_CHEQUE, ETIQUETA_MOVIMIENTO_TESORERIA } from '@/lib/tesoreria/constants';
import {
  calcularMontoUsadoCheque,
  calcularSaldoDisponibleCheque,
} from '@/lib/tesoreria/cheque-saldo';
import { fetchEffectiveBusinessPrefsForTesoreria } from '@/lib/tesoreria/resolve-caja';
import { withTesoreriaApi } from '@/lib/tesoreria/api-context';

export async function GET(request: Request) {
  return withTesoreriaApi(request, async ({ session, db, cajaTesoreriaId, saldoEfectivo, sucursalId }) => {
    const url = new URL(request.url);
    const fechaDesde = url.searchParams.get('fecha_desde')?.trim() || null;
    const fechaHasta = url.searchParams.get('fecha_hasta')?.trim() || null;
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);

    const prefs = await fetchEffectiveBusinessPrefsForTesoreria(db, session.tenantId, sucursalId);

    const { data: caja } = await (db as any)
      .from('caja_tesoreria')
      .select('id, nombre, sucursal_id, activa')
      .eq('id', cajaTesoreriaId)
      .single();

    let movQ = (db as any)
      .from('caja_tesoreria_movimiento')
      .select(
        'id, tipo, monto, es_ingreso, cierre_z_id, caja_id, pago_id, cheque_id, proveedor_id, notas, fecha, created_at, usuario_id, proveedor:proveedor_id(nombre)',
      )
      .eq('caja_tesoreria_id', cajaTesoreriaId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (fechaDesde) movQ = movQ.gte('fecha', fechaDesde);
    if (fechaHasta) movQ = movQ.lte('fecha', fechaHasta);

    const { data: movimientos, error: movErr } = await movQ;
    if (movErr) return NextResponse.json({ error: movErr.message }, { status: 500 });

    const { data: movsCheque, error: movChErr } = await (db as any)
      .from('caja_tesoreria_movimiento')
      .select('cheque_id, tipo, monto, es_ingreso')
      .eq('caja_tesoreria_id', cajaTesoreriaId)
      .not('cheque_id', 'is', null)
      .in('tipo', ['egreso_cheque', 'ajuste']);

    if (movChErr) return NextResponse.json({ error: movChErr.message }, { status: 500 });

    const movsChequeList = (movsCheque ?? []) as {
      cheque_id: string;
      tipo: string;
      monto: number;
      es_ingreso: boolean;
    }[];

    const { data: cheques, error: chErr } = await (db as any)
      .from('caja_tesoreria_cheque')
      .select(
        'id, numero, banco, titular, fecha_emision, fecha_cobro, monto, estado, notas, created_at, pago_id',
      )
      .eq('caja_tesoreria_id', cajaTesoreriaId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (chErr) return NextResponse.json({ error: chErr.message }, { status: 500 });

    type ChequeDbRow = Record<string, unknown> & {
      id: string;
      monto: number;
      estado: string;
    };

    const chequesFmt = ((cheques ?? []) as ChequeDbRow[]).map((c) => {
      const id = c.id as string;
      const monto = Number(c.monto);
      const saldoDisponible =
        c.estado === 'en_cartera'
          ? calcularSaldoDisponibleCheque(monto, id, movsChequeList)
          : 0;
      const montoUsado = calcularMontoUsadoCheque(monto, saldoDisponible);
      return {
        ...c,
        saldo_disponible: saldoDisponible,
        monto_usado: montoUsado,
        estado_etiqueta: ETIQUETA_ESTADO_CHEQUE[c.estado as keyof typeof ETIQUETA_ESTADO_CHEQUE] ?? c.estado,
      };
    });

    const chequesEnCartera = chequesFmt.filter(
      (c) => c.estado === 'en_cartera' && Number(c.saldo_disponible) > 0.01,
    );
    const totalChequesCartera = chequesEnCartera.reduce(
      (acc, c) => acc + Number(c.saldo_disponible),
      0,
    );

    const movs = ((movimientos ?? []) as Record<string, unknown>[]).map((m) => ({
      ...m,
      tipo_etiqueta: ETIQUETA_MOVIMIENTO_TESORERIA[m.tipo as keyof typeof ETIQUETA_MOVIMIENTO_TESORERIA] ?? m.tipo,
      proveedor_nombre:
        m.proveedor && typeof m.proveedor === 'object' && 'nombre' in m.proveedor
          ? (m.proveedor as { nombre: string }).nombre
          : null,
    }));

    return NextResponse.json({
      caja,
      alcance: prefs.cajaInterna.alcance,
      saldo_efectivo: saldoEfectivo,
      total_cheques_cartera: totalChequesCartera,
      cantidad_cheques_cartera: chequesEnCartera.length,
      movimientos: movs,
      cheques: chequesFmt,
    });
  });
}
