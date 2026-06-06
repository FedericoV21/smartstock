import { Repository } from 'typeorm';

import { ComprobanteItem } from '../../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';

export type VentaLinea = {
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  precio_costo: number;
  fecha: string;
  tipo: string;
};

export async function fetchVentasLineas(
  compItemRepo: Repository<ComprobanteItem>,
  tenantId: string,
  opts?: { desde?: string; hasta?: string },
): Promise<VentaLinea[]> {
  const qb = compItemRepo
    .createQueryBuilder('ci')
    .innerJoin(Comprobante, 'c', 'c.id = ci.comprobante_id')
    .where('c.tenant_id = :tenantId', { tenantId })
    .andWhere('c.estado = :estado', { estado: EstadoComprobante.emitido })
    .andWhere('c.tipo <> :presupuesto', { presupuesto: TipoComprobante.presupuesto })
    .select([
      'ci.producto_id AS producto_id',
      'ci.cantidad AS cantidad',
      'ci.precio_unitario AS precio_unitario',
      'ci.precio_costo AS precio_costo',
      'c.fecha AS fecha',
      'c.tipo AS tipo',
    ]);

  if (opts?.desde) qb.andWhere('c.fecha >= :desde', { desde: opts.desde });
  if (opts?.hasta) qb.andWhere('c.fecha <= :hasta', { hasta: opts.hasta });

  const rows = await qb.getRawMany<{
    producto_id: string;
    cantidad: string;
    precio_unitario: string;
    precio_costo: string | null;
    fecha: string;
    tipo: string;
  }>();

  return rows.map((r) => ({
    producto_id: r.producto_id,
    cantidad: Number(r.cantidad),
    precio_unitario: Number(r.precio_unitario),
    precio_costo: Number(r.precio_costo ?? 0),
    fecha: r.fecha,
    tipo: r.tipo,
  }));
}

export function signoTipo(tipo: string): number {
  return tipo.startsWith('nota_credito') ? -1 : 1;
}
