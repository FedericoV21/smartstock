import { describe, expect, it } from 'vitest';

import {
  anticipacionRecordatorioSegunCondicion,
  comprobanteGeneraRegistroCobranzaVenta,
  construirUrlWhatsAppCobranza,
  debeMostrarEnCampanaCobranza,
  esTipoFacturaVenta,
  telefonoArgentinoAE164,
} from '@/lib/cobranza/logic';

describe('esTipoFacturaVenta', () => {
  it('acepta A/B/C', () => {
    expect(esTipoFacturaVenta('factura_a')).toBe(true);
    expect(esTipoFacturaVenta('factura_b')).toBe(true);
    expect(esTipoFacturaVenta('factura_c')).toBe(true);
  });
  it('rechaza otros', () => {
    expect(esTipoFacturaVenta('ticket')).toBe(false);
    expect(esTipoFacturaVenta('presupuesto')).toBe(false);
  });
});

describe('comprobanteGeneraRegistroCobranzaVenta', () => {
  it('incluye facturas y ticket', () => {
    expect(comprobanteGeneraRegistroCobranzaVenta('factura_b')).toBe(true);
    expect(comprobanteGeneraRegistroCobranzaVenta('ticket')).toBe(true);
  });
  it('rechaza presupuesto', () => {
    expect(comprobanteGeneraRegistroCobranzaVenta('presupuesto')).toBe(false);
  });
});

describe('debeMostrarEnCampanaCobranza', () => {
  const venc22Abr = new Date('2026-04-22T20:00:00.000-03:00');

  it('no muestra sin saldo', () => {
    expect(
      debeMostrarEnCampanaCobranza({
        saldoPendiente: 0,
        vencimientoAt: venc22Abr,
        recordatorioSnoozeUntil: null,
        now: new Date('2026-04-21T10:00:00.000-03:00'),
      }).mostrar,
    ).toBe(false);
  });

  it('no muestra si faltan más de 2 días calendario (AR)', () => {
    expect(
      debeMostrarEnCampanaCobranza({
        saldoPendiente: 100,
        vencimientoAt: venc22Abr,
        recordatorioSnoozeUntil: null,
        now: new Date('2026-04-19T10:00:00.000-03:00'),
      }).mostrar,
    ).toBe(false);
  });

  it('muestra el día anterior al vencimiento (ej. 21 si vence 22)', () => {
    const r = debeMostrarEnCampanaCobranza({
      saldoPendiente: 100,
      vencimientoAt: venc22Abr,
      recordatorioSnoozeUntil: null,
      now: new Date('2026-04-21T10:00:00.000-03:00'),
    });
    expect(r.mostrar).toBe(true);
    expect(r.estado).toBe('recordatorio_dia_5');
  });

  it('muestra en ventana a 2 días calendario del vencimiento', () => {
    const r = debeMostrarEnCampanaCobranza({
      saldoPendiente: 100,
      vencimientoAt: venc22Abr,
      recordatorioSnoozeUntil: null,
      now: new Date('2026-04-20T10:00:00.000-03:00'),
    });
    expect(r.mostrar).toBe(true);
    expect(r.estado).toBe('recordatorio_dia_5');
  });

  it('respeta anticipación configurable por condición (no muestra fuera de ventana)', () => {
    const r = debeMostrarEnCampanaCobranza({
      saldoPendiente: 100,
      vencimientoAt: venc22Abr,
      recordatorioSnoozeUntil: null,
      anticipacionDias: 1,
      now: new Date('2026-04-20T10:00:00.000-03:00'),
    });
    expect(r.mostrar).toBe(false);
  });

  it('muestra vencido por día calendario en AR', () => {
    const r = debeMostrarEnCampanaCobranza({
      saldoPendiente: 50,
      vencimientoAt: venc22Abr,
      recordatorioSnoozeUntil: null,
      now: new Date('2026-04-23T10:00:00.000-03:00'),
    });
    expect(r.mostrar).toBe(true);
    expect(r.estado).toBe('vencido');
  });

  it('respeta snooze', () => {
    const now = new Date('2026-04-23T10:00:00.000-03:00');
    expect(
      debeMostrarEnCampanaCobranza({
        saldoPendiente: 50,
        vencimientoAt: venc22Abr,
        recordatorioSnoozeUntil: new Date(now.getTime() + 60_000),
        now,
      }).mostrar,
    ).toBe(false);
  });

  it('cliente cobranza diaria: muestra aunque el vencimiento esté muy lejos (saldo pendiente)', () => {
    const lejano = new Date('2026-05-31T23:59:59.999-03:00');
    const r = debeMostrarEnCampanaCobranza({
      saldoPendiente: 200,
      vencimientoAt: lejano,
      recordatorioSnoozeUntil: null,
      clientePeriodicidadDiaria: true,
      now: new Date('2026-04-01T10:00:00.000-03:00'),
    });
    expect(r.mostrar).toBe(true);
    expect(r.estado).toBe('saldo_cobranza_diaria');
  });

  it('cliente cobranza diaria: vencido prioriza etiqueta vencido', () => {
    const r = debeMostrarEnCampanaCobranza({
      saldoPendiente: 50,
      vencimientoAt: venc22Abr,
      recordatorioSnoozeUntil: null,
      clientePeriodicidadDiaria: true,
      now: new Date('2026-04-23T10:00:00.000-03:00'),
    });
    expect(r.mostrar).toBe(true);
    expect(r.estado).toBe('vencido');
  });
});

describe('anticipacionRecordatorioSegunCondicion', () => {
  it('periodicidad semanal => 1 día', () => {
    expect(
      anticipacionRecordatorioSegunCondicion({
        cobroModalidad: 'periodico',
        cobroPeriodicidad: 'semanal',
        cobroDiasPlazo: null,
      }),
    ).toBe(1);
  });

  it('día fijo de mes => 3 días', () => {
    expect(
      anticipacionRecordatorioSegunCondicion({
        cobroModalidad: 'dia_fijo_mes',
        cobroPeriodicidad: null,
        cobroDiasPlazo: null,
      }),
    ).toBe(3);
  });
});

describe('telefonoArgentinoAE164', () => {
  it('normaliza 11 dígitos sin prefijo', () => {
    expect(telefonoArgentinoAE164('351 123-4567')).toBe('543511234567');
  });
  it('respeta 54', () => {
    expect(telefonoArgentinoAE164('+54 9 11 1234-5678')).toBe('5491112345678');
  });
});

describe('construirUrlWhatsAppCobranza', () => {
  it('incluye wa.me y texto codificado', () => {
    const url = construirUrlWhatsAppCobranza({
      telefonoE164: '5491112345678',
      clienteNombre: 'Juan',
      tipoFacturaLabel: 'Factura B',
      numeroComprobante: '0001-00000123',
      saldoPendiente: 1500,
      monedaLabel: '$',
      vencimientoLabel: '20/04/2026',
      estado: 'recordatorio_dia_5',
      pdfUrl: null,
    });
    expect(url.startsWith('https://wa.me/5491112345678?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1] ?? '')).toContain('Juan');
  });

  it('mensaje específico para cobranza diaria', () => {
    const url = construirUrlWhatsAppCobranza({
      telefonoE164: '5491112345678',
      clienteNombre: 'Juan',
      tipoFacturaLabel: 'Factura B',
      numeroComprobante: '0001-00000123',
      saldoPendiente: 1500,
      monedaLabel: '$',
      vencimientoLabel: '01/06/2026',
      estado: 'saldo_cobranza_diaria',
      pdfUrl: null,
    });
    expect(decodeURIComponent(url.split('text=')[1] ?? '')).toContain('cobranza diaria');
  });
});
