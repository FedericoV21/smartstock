import { describe, expect, it } from 'vitest';

import { parseVentasPosReportFilters } from '@/lib/whatsapp/ventas-pos-report';

describe('parseVentasPosReportFilters', () => {
  it('extrae caja con periodo intermedio', () => {
    expect(parseVentasPosReportFilters('ventas pos hoy caja mostrador')).toEqual({
      cajaQuery: 'mostrador',
    });
  });

  it('extrae operador', () => {
    expect(parseVentasPosReportFilters('ventas pos hoy operador maria lopez')).toEqual({
      operadorQuery: 'maria lopez',
    });
  });

  it('extrae caja por numero', () => {
    expect(parseVentasPosReportFilters('tickets pos caja 2 hoy')).toEqual({
      cajaQuery: '2',
    });
  });
});
