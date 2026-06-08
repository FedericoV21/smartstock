import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { PagoProveedorFactura } from '../importaciones/entities/pago-proveedor-factura.entity';
import { RegistrarPagoProveedorFacturaDto } from './dto/registrar-pago-proveedor-factura.dto';
import { PagoProveedorMovimiento } from './entities/pago-proveedor-movimiento.entity';
import { TipoPago } from './enums/tipo-pago.enum';

type RpcPagoResult = {
  pago_proveedor_movimiento_id?: string;
  nuevo_saldo?: number;
  pago_cuenta_corriente_id?: string;
  monto_aplicado?: number;
  saldo_a_favor_generado?: number;
};

@Injectable()
export class PagoProveedorFacturaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PagoProveedorFactura)
    private readonly obligacionRepo: Repository<PagoProveedorFactura>,
    @InjectRepository(PagoProveedorMovimiento)
    private readonly movimientoRepo: Repository<PagoProveedorMovimiento>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async registrar(obligacionId: string, dto: RegistrarPagoProveedorFacturaDto, usuarioId: string) {
    await this.assertStock();
    const tenantId = this.tenantContext.getTenantId();

    const row = await this.obligacionRepo.findOne({
      where: { id: obligacionId, tenantId },
      select: { id: true, estado: true },
    });

    if (!row) {
      throw new NotFoundException('Obligación no encontrada');
    }

    if (row.estado === 'anulada') {
      throw new BadRequestException('Obligación anulada');
    }

    const tipoPago = dto.tipo_pago ?? TipoPago.efectivo;
    const fecha =
      dto.fecha != null && String(dto.fecha).trim() !== '' ? String(dto.fecha).trim().slice(0, 10) : null;

    let resultado: RpcPagoResult;
    try {
      const rows = (await this.dataSource.query(
        `SELECT public.registrar_pago_proveedor_obligacion(
          $1::uuid, $2::uuid, $3::numeric, $4::public.tipo_pago, $5::text, $6::uuid, $7::date
        ) AS resultado`,
        [
          tenantId,
          obligacionId,
          dto.monto,
          tipoPago,
          dto.notas?.trim() || null,
          usuarioId,
          fecha,
        ],
      )) as Array<{ resultado: RpcPagoResult }>;
      resultado = rows[0]?.resultado ?? {};
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('supera el saldo') || msg.includes('encontrad') || msg.includes('anulada')) {
        throw new BadRequestException(msg);
      }
      if (msg.includes('mayor a cero')) {
        throw new BadRequestException('monto debe ser un número mayor a cero');
      }
      throw new InternalServerErrorException(msg || 'Error al registrar pago');
    }

    if (resultado.pago_proveedor_movimiento_id && resultado.pago_cuenta_corriente_id) {
      const updated = await this.movimientoRepo.update(
        {
          id: resultado.pago_proveedor_movimiento_id,
          tenantId,
        },
        { pagoCuentaCorrienteId: resultado.pago_cuenta_corriente_id },
      );
      if (!updated.affected) {
        throw new InternalServerErrorException(
          'Pago registrado, pero no se pudo vincular para reversión',
        );
      }
    }

    return { resultado };
  }

  private async assertStock(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.stock) {
      throw new ForbiddenException('Módulo stock no habilitado');
    }
  }
}
