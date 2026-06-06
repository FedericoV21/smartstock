import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';

import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';
import { Pedido } from '../../pedidos/entities/pedido.entity';

type OrigenKind = 'comprobante' | 'pedido';

export async function asegurarNumeroOrdenOrigen(
  manager: EntityManager,
  opts: {
    tenantId: string;
    origen: OrigenKind;
    origenId: string;
    numeroOrdenActual: number | null | undefined;
  },
): Promise<number> {
  if (opts.numeroOrdenActual != null && Number.isFinite(Number(opts.numeroOrdenActual))) {
    return Number(opts.numeroOrdenActual);
  }

  const rows = (await manager.query(`SELECT public.siguiente_numero_orden($1::uuid) AS n`, [
    opts.tenantId,
  ])) as Array<{ n?: number | string }>;
  const numeroOrden = Number(rows[0]?.n);
  if (!Number.isFinite(numeroOrden)) {
    throw new Error('No se pudo obtener el n├║mero de orden');
  }

  if (opts.origen === 'comprobante') {
    await manager.update(Comprobante, { id: opts.origenId, tenantId: opts.tenantId }, { numeroOrden });
  } else {
    await manager.update(Pedido, { id: opts.origenId, tenantId: opts.tenantId }, { numeroOrden });
  }

  return numeroOrden;
}

export async function validarOrdenSinFacturaFiscal(
  manager: EntityManager,
  opts: { tenantId: string; numeroOrden: number | null | undefined },
): Promise<void> {
  if (opts.numeroOrden == null) return;

  const existing = await manager.findOne(Comprobante, {
    where: {
      tenantId: opts.tenantId,
      numeroOrden: opts.numeroOrden,
      tipo: In([TipoComprobante.factura_a, TipoComprobante.factura_b, TipoComprobante.factura_c]),
      estado: EstadoComprobante.emitido,
    },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictOrdenError('Ya existe una factura fiscal emitida para esta orden de venta.');
  }
}

export async function validarOrdenSinTicketEmitido(
  manager: EntityManager,
  opts: { tenantId: string; numeroOrden: number | null | undefined },
): Promise<void> {
  if (opts.numeroOrden == null) return;

  const existing = await manager.findOne(Comprobante, {
    where: {
      tenantId: opts.tenantId,
      numeroOrden: opts.numeroOrden,
      tipo: TipoComprobante.ticket,
      estado: EstadoComprobante.emitido,
    },
    select: { id: true, numero: true },
  });
  if (existing) {
    throw new ConflictOrdenError(
      'Ya existe un ticket emitido para esta orden de venta. Pod├®s abrirlo en Facturaci├│n o fiscalizarlo si a├║n no tiene factura.',
    );
  }
}

export class ConflictOrdenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictOrdenError';
  }
}
