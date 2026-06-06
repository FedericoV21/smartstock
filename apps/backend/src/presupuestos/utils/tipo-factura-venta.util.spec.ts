import { BadRequestException } from '@nestjs/common';

import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';
import { determinarTipoFactura, resolverTipoFacturaVentaSolicitado } from './tipo-factura-venta.util';
import { CondicionIva } from '../../catalog/enums/condicion-iva.enum';

describe('tipo-factura-venta.util', () => {
  it('determina factura A para RI ÔåÆ RI', () => {
    expect(
      determinarTipoFactura(CondicionIva.responsable_inscripto, CondicionIva.responsable_inscripto),
    ).toBe(TipoComprobante.factura_a);
  });

  it('determina factura B para RI ÔåÆ CF', () => {
    expect(
      determinarTipoFactura(CondicionIva.responsable_inscripto, CondicionIva.consumidor_final),
    ).toBe(TipoComprobante.factura_b);
  });

  it('rechaza tipo incompatible', () => {
    expect(() =>
      resolverTipoFacturaVentaSolicitado(
        TipoComprobante.factura_a,
        CondicionIva.monotributista,
        CondicionIva.consumidor_final,
      ),
    ).toThrow(BadRequestException);
  });
});
