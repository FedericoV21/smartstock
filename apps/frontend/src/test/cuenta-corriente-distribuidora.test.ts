import { describe, expect, it } from 'vitest';

import { normalizeBusinessPrefs } from '@/lib/business-prefs/prefs';
import { normalizeCajaPrefs } from '@/lib/caja/prefs';
import { montoPendienteCuentaCorrienteEmitir } from '@/lib/cobranza/monto-pendiente-emision';
import {
  armarExtractoCuentaCorriente,
  comprobanteALineaExtracto,
  extractoACsv,
} from '@/lib/cuenta-corriente/extracto';
import {
  buildMovimientosDiaPayload,
  contarCargosHoyPorCliente,
  mapComprobantesAMovimientosDia,
} from '@/lib/cuenta-corriente/movimientos-dia';
import { marcarEditableLiquidacionDia } from '@/lib/cuenta-corriente/liquidar-items-dia';
import { resolverTicketOcultarImportesCc } from '@/lib/cuenta-corriente/ticket-ocultar-importes';

describe('cuenta corriente distribuidora — integración de reglas', () => {
  const defaults = normalizeBusinessPrefs({});
  const sucursalMayorista = normalizeBusinessPrefs({
    cuentaCorrienteDistribuidora: {
      permitirAjustesPorCaja: true,
      panelMovimientosDia: true,
      permitirLiquidacionItemsDia: true,
    },
  });
  const cajaDespacho = normalizeCajaPrefs({
    cuentaCorrienteCaja: { ticketOcultarImportes: true },
  });

  it('defaults OFF en tenant y caja', () => {
    expect(defaults.cuentaCorrienteDistribuidora.permitirAjustesPorCaja).toBe(false);
    expect(defaults.cuentaCorrienteDistribuidora.panelMovimientosDia).toBe(false);
    expect(defaults.cuentaCorrienteDistribuidora.permitirLiquidacionItemsDia).toBe(false);
    expect(normalizeCajaPrefs({}).cuentaCorrienteCaja.ticketOcultarImportes).toBe(false);
  });

  it('flujo A: ticket sin importes solo con sucursal + caja + CC', () => {
    expect(
      resolverTicketOcultarImportesCc({
        metodoPago: 'cuenta_corriente',
        businessPrefs: sucursalMayorista,
        cajaPrefs: cajaDespacho,
      }),
    ).toBe(true);
    expect(
      resolverTicketOcultarImportesCc({
        metodoPago: 'mixto',
        businessPrefs: sucursalMayorista,
        cajaPrefs: cajaDespacho,
      }),
    ).toBe(false);
  });

  it('flujo B: panel marca editable liquidación según prefs', () => {
    const rows = [
      {
        id: 'c1',
        tipo: 'ticket',
        numero: 1,
        numero_caja: null,
        fecha: '2026-05-30',
        created_at: '2026-05-30T12:00:00Z',
        total: 500,
        cae: null,
        comprobante_item: [],
      },
    ];
    const sinLiq = mapComprobantesAMovimientosDia(rows, 1, { liquidacionHabilitada: false });
    const conLiq = mapComprobantesAMovimientosDia(rows, 1, { liquidacionHabilitada: true });
    expect(sinLiq[0].editable).toBe(false);
    expect(conLiq[0].editable).toBe(true);
    expect(marcarEditableLiquidacionDia('factura_b', null)).toBe(true);
    expect(marcarEditableLiquidacionDia('factura_a', null)).toBe(false);
  });

  it('extracto: pago mixto solo cuenta corriente en debe', () => {
    const montoCc = montoPendienteCuentaCorrienteEmitir({
      metodo_pago: 'mixto',
      metodo_pago_detalle: { cuenta_corriente: 400, efectivo: 600 },
      totalComprobante: 1000,
    });
    expect(montoCc).toBe(400);
    const linea = comprobanteALineaExtracto(
      {
        id: 'c1',
        tipo: 'ticket',
        numero: 10,
        numero_caja: null,
        fecha: '2026-05-30',
        created_at: '2026-05-30T10:00:00Z',
        total: 1000,
        metodo_pago: 'mixto',
        metodo_pago_detalle: { cuenta_corriente: 400 },
        sucursal_id: 's1',
      },
      1,
    );
    expect(linea?.debe).toBe(400);
  });

  it('extracto: nota de crédito en haber', () => {
    const linea = comprobanteALineaExtracto(
      {
        id: 'nc1',
        tipo: 'nota_credito_b',
        numero: 2,
        numero_caja: null,
        fecha: '2026-05-30',
        created_at: '2026-05-30T11:00:00Z',
        total: 150,
        metodo_pago: 'cuenta_corriente',
        metodo_pago_detalle: null,
        sucursal_id: 's1',
      },
      1,
    );
    expect(linea?.haber).toBe(150);
    expect(linea?.debe).toBe(0);
  });

  it('badge cargos hoy agrupa por cliente', () => {
    expect(
      contarCargosHoyPorCliente([
        { cliente_id: 'a' },
        { cliente_id: 'a' },
        { cliente_id: 'b' },
      ]),
    ).toEqual({ a: 2, b: 1 });
  });

  it('extracto CSV incluye saldos y líneas', () => {
    const payload = buildMovimientosDiaPayload({
      sucursalId: 's1',
      sucursalNombre: 'Depo',
      saldoCuenta: 100,
      comprobantes: [],
      puntoDeVenta: 1,
      fecha: '2026-05-30',
    });
    const extracto = armarExtractoCuentaCorriente({
      clienteId: 'c1',
      clienteNombre: 'Cliente Demo',
      periodo: { desde: '2026-05-01', hasta: '2026-05-30', label: 'Mes' },
      sucursalId: 's1',
      saldoActual: 100,
      comprobantes: [],
      pagos: [],
      puntoDeVenta: 1,
    });
    const csv = extractoACsv(extracto);
    expect(csv).toContain('Cliente Demo');
    expect(csv).toContain('Saldo inicial');
    expect(payload.total_cargos_dia).toBe(0);
  });
});
