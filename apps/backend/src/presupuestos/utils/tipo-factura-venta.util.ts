import { BadRequestException } from '@nestjs/common';

import { CondicionIva } from '../../catalog/enums/condicion-iva.enum';
import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';

export type TipoFacturaVenta = TipoComprobante.factura_a | TipoComprobante.factura_b | TipoComprobante.factura_c;

const TIPOS_FACTURA = new Set<string>([
  TipoComprobante.factura_a,
  TipoComprobante.factura_b,
  TipoComprobante.factura_c,
]);

function normalizarCondicion(value: CondicionIva | null | undefined): CondicionIva {
  switch (value) {
    case CondicionIva.responsable_inscripto:
    case CondicionIva.monotributista:
    case CondicionIva.exento:
    case CondicionIva.consumidor_final:
      return value;
    default:
      return CondicionIva.consumidor_final;
  }
}

export function determinarTipoFactura(
  emisor: CondicionIva | null | undefined,
  receptor: CondicionIva | null | undefined,
): TipoFacturaVenta {
  const e = normalizarCondicion(emisor);
  const r = normalizarCondicion(receptor);

  if (e === CondicionIva.monotributista || e === CondicionIva.exento) {
    return TipoComprobante.factura_c;
  }
  if (e === CondicionIva.responsable_inscripto) {
    return r === CondicionIva.responsable_inscripto
      ? TipoComprobante.factura_a
      : TipoComprobante.factura_b;
  }
  return TipoComprobante.factura_c;
}

export function resolverTipoFacturaVentaSolicitado(
  tipoRaw: unknown,
  emisor: CondicionIva | null | undefined,
  receptor: CondicionIva | null | undefined,
): TipoFacturaVenta {
  if (tipoRaw == null || tipoRaw === '') {
    return determinarTipoFactura(emisor, receptor);
  }
  if (typeof tipoRaw !== 'string' || !TIPOS_FACTURA.has(tipoRaw)) {
    throw new BadRequestException('tipo de factura inv├ílido');
  }
  const permitido = determinarTipoFactura(emisor, receptor);
  if (tipoRaw !== permitido) {
    throw new BadRequestException(
      `El tipo ${tipoRaw} no corresponde al par emisor/receptor (esperado: ${permitido}).`,
    );
  }
  return tipoRaw as TipoFacturaVenta;
}
