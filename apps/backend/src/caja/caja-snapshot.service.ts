import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import {
  calcularSnapshotDesdeComprobantes,
  ComprobanteCierreRow,
  ModoPeriodoCierre,
  rangoFechasParaSnapshot,
  SnapshotCierreZ,
} from './utils/cierre-z-calculo.util';
import { normalizarCaja } from './utils/caja-id.util';

@Injectable()
export class CajaSnapshotService {
  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
  ) {}

  async calcularSnapshot(opts: {
    tenantId: string;
    fechaOperativa: string;
    cajaIdNormalizada: string;
    sucursalId: string;
    rangoDesdeIso: string;
    rangoHastaIso: string;
    fondoApertura?: number;
    modoPeriodo?: ModoPeriodoCierre;
    sesionAperturaId?: string | null;
  }): Promise<SnapshotCierreZ> {
    const usarRangoFechas = opts.modoPeriodo === 'sesion_apertura';
    const fechasPeriodo = rangoFechasParaSnapshot(
      opts.rangoDesdeIso,
      opts.rangoHastaIso,
      opts.fechaOperativa,
    );

    const qb = this.comprobanteRepo
      .createQueryBuilder('c')
      .select([
        'c.id',
        'c.total',
        'c.tipo',
        'c.metodoPago',
        'c.metodoPagoDetalle',
        'c.cajaId',
        'c.numeroOrden',
      ])
      .where('c.tenant_id = :tenantId', { tenantId: opts.tenantId })
      .andWhere('c.estado = :estado', { estado: EstadoComprobante.emitido })
      .andWhere('c.sucursal_id = :sucursalId', { sucursalId: opts.sucursalId })
      .andWhere('c.created_at >= :desde', { desde: opts.rangoDesdeIso })
      .andWhere('c.created_at <= :hasta', { hasta: opts.rangoHastaIso });

    if (usarRangoFechas) {
      qb.andWhere('c.fecha >= :fd', { fd: fechasPeriodo.desde }).andWhere('c.fecha <= :fh', {
        fh: fechasPeriodo.hasta,
      });
    } else {
      qb.andWhere('c.fecha = :fechaOp', { fechaOp: opts.fechaOperativa });
    }

    const cajaNorm = normalizarCaja(opts.cajaIdNormalizada);
    if (cajaNorm === '__sin_caja__') {
      qb.andWhere('c.caja_id IS NULL');
    } else {
      qb.andWhere('c.caja_id = :cajaId', { cajaId: cajaNorm });
    }

    const rows = await qb.getMany();
    const comprobantes: ComprobanteCierreRow[] = rows.map((c) => ({
      id: c.id,
      total: Number(c.total),
      tipo: c.tipo,
      metodo_pago: c.metodoPago,
      metodo_pago_detalle: c.metodoPagoDetalle,
      caja_id: c.cajaId,
      numero_orden: c.numeroOrden,
    }));

    return calcularSnapshotDesdeComprobantes(comprobantes, {
      fechaOperativa: opts.fechaOperativa,
      fondoApertura: opts.fondoApertura,
      modoPeriodo: opts.modoPeriodo,
      sesionAperturaId: opts.sesionAperturaId,
    });
  }
}
