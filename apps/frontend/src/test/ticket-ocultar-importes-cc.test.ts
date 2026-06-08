import { describe, expect, it } from 'vitest';

import { normalizeBusinessPrefs } from '@/lib/business-prefs/prefs';
import { normalizeCajaPrefs } from '@/lib/caja/prefs';
import {
  resolverTicketOcultarImportesCc,
  ticketOcultarImportesDesdeDetallePago,
} from '@/lib/cuenta-corriente/ticket-ocultar-importes';

describe('ticket CC sin importes', () => {
  const bizOff = normalizeBusinessPrefs({});
  const bizOn = normalizeBusinessPrefs({
    cuentaCorrienteDistribuidora: { permitirAjustesPorCaja: true },
  });
  const cajaOff = normalizeCajaPrefs({});
  const cajaOn = normalizeCajaPrefs({
    cuentaCorrienteCaja: { ticketOcultarImportes: true },
  });

  it('requiere venta CC, sucursal y caja', () => {
    expect(
      resolverTicketOcultarImportesCc({
        metodoPago: 'cuenta_corriente',
        businessPrefs: bizOn,
        cajaPrefs: cajaOn,
      }),
    ).toBe(true);
    expect(
      resolverTicketOcultarImportesCc({
        metodoPago: 'efectivo',
        businessPrefs: bizOn,
        cajaPrefs: cajaOn,
      }),
    ).toBe(false);
    expect(
      resolverTicketOcultarImportesCc({
        metodoPago: 'cuenta_corriente',
        businessPrefs: bizOff,
        cajaPrefs: cajaOn,
      }),
    ).toBe(false);
    expect(
      resolverTicketOcultarImportesCc({
        metodoPago: 'cuenta_corriente',
        businessPrefs: bizOn,
        cajaPrefs: cajaOff,
      }),
    ).toBe(false);
  });

  it('lee flag persistido en comprobante', () => {
    expect(
      ticketOcultarImportesDesdeDetallePago('cuenta_corriente', {
        ticket_ocultar_importes: true,
      }),
    ).toBe(true);
    expect(
      resolverTicketOcultarImportesCc({
        metodoPago: 'cuenta_corriente',
        businessPrefs: bizOff,
        cajaPrefs: cajaOff,
        persistidoEnComprobante: true,
      }),
    ).toBe(true);
  });
});
