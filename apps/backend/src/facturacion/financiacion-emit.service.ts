import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MedioPagoOpcion } from '../payment-methods/entities/medio-pago-opcion.entity';
import { MedioPagoRapido } from '../payment-methods/entities/medio-pago-rapido.entity';
import { CodigoMedioRapido, DEFAULT_RAPIDOS } from '../payment-methods/enums/codigo-medio-rapido.enum';
import { EmitComprobanteDto } from './dto/emit-comprobante.dto';
import {
  aplicarFinanciacion,
  aplicarFinanciacionMixto,
  CODIGOS_MEDIO_RAPIDO,
  FinanciacionEmitResult,
  ImportesBase,
  LABEL_MEDIO_RAPIDO,
  OpcionFinanciacion,
  validarDetalleMixto,
} from './utils/financiacion';

@Injectable()
export class FinanciacionEmitService {
  constructor(
    @InjectRepository(MedioPagoOpcion)
    private readonly opcionRepo: Repository<MedioPagoOpcion>,
    @InjectRepository(MedioPagoRapido)
    private readonly rapidoRepo: Repository<MedioPagoRapido>,
  ) {}

  async resolveForEmit(
    tenantId: string,
    dto: EmitComprobanteDto,
    importesBase: ImportesBase,
    clienteId?: string | null,
  ): Promise<FinanciacionEmitResult> {
    const metodo = dto.metodoPago?.trim() ?? '';

    if (metodo === 'mixto') {
      const raw = dto.metodoPagoDetalle;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BadRequestException(
          'Pago mixto: envi├í metodo_pago_detalle con montos en efectivo, d├®bito, cr├®dito y transferencia (la suma debe igualar el total del comprobante).',
        );
      }
      const val = validarDetalleMixto(raw as Record<string, unknown>, importesBase.total);
      if (!val.ok) {
        throw new BadRequestException(val.error);
      }
      if (val.detalle.cuenta_corriente > 0.02 && !clienteId) {
        throw new BadRequestException(
          'La parte en cuenta corriente del pago mixto requiere un cliente identificado.',
        );
      }
      const pctMap = await this.loadRapidosMap(tenantId);
      const fin = aplicarFinanciacionMixto(importesBase, val.detalle, pctMap);
      return { ...fin, metodoPagoDetalle: val.detalle };
    }

    let opcion: OpcionFinanciacion | null = null;
    let medioPagoOpcionId: string | null = null;

    if (dto.medioPagoOpcionId) {
      const catalogo = await this.loadOpcionCatalogo(tenantId, dto.medioPagoOpcionId);
      if (!catalogo) {
        throw new BadRequestException('La opci├│n de medio de pago no existe o est├í inactiva.');
      }
      opcion = catalogo.opcion;
      medioPagoOpcionId = catalogo.opcionId;
    } else if (metodo && CODIGOS_MEDIO_RAPIDO.has(metodo)) {
      opcion = await this.loadFinanciacionRapida(tenantId, metodo);
    }

    const fin = aplicarFinanciacion(importesBase, opcion);
    return {
      ...fin,
      medioPagoOpcionId: fin.esPagoMixto ? null : medioPagoOpcionId,
    };
  }

  private async loadOpcionCatalogo(
    tenantId: string,
    opcionId: string,
  ): Promise<{ opcionId: string; opcion: OpcionFinanciacion } | null> {
    const row = await this.opcionRepo.findOne({
      where: { id: opcionId },
      relations: { medioPago: true },
    });
    if (!row?.medioPago || row.medioPago.tenantId !== tenantId || !row.medioPago.activo) {
      return null;
    }
    return {
      opcionId: row.id,
      opcion: {
        medioNombre: row.medioPago.nombre,
        cuotas: row.cuotas,
        recargo_porcentaje: Number(row.recargoPorcentaje),
      },
    };
  }

  private async loadFinanciacionRapida(
    tenantId: string,
    metodo: string,
  ): Promise<OpcionFinanciacion | null> {
    const row = await this.rapidoRepo.findOne({
      where: { tenantId, codigo: metodo as CodigoMedioRapido },
    });
    const pct = row != null ? Number(row.recargoPorcentaje) : 0;
    if (!Number.isFinite(pct) || Math.abs(pct) < 1e-9) {
      return null;
    }
    return {
      medioNombre: LABEL_MEDIO_RAPIDO[metodo] ?? metodo,
      cuotas: 1,
      recargo_porcentaje: pct,
    };
  }

  private async loadRapidosMap(tenantId: string): Promise<Record<string, number>> {
    const rows = await this.rapidoRepo.find({ where: { tenantId } });
    const map: Record<string, number> = { ...DEFAULT_RAPIDOS };
    for (const row of rows) {
      map[row.codigo] = Number(row.recargoPorcentaje);
    }
    return map;
  }
}
