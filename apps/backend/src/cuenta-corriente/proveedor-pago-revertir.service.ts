import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { PagoProveedorFactura } from '../importaciones/entities/pago-proveedor-factura.entity';
import { PagoProveedorMovimiento } from './entities/pago-proveedor-movimiento.entity';
import { Pago } from './entities/pago.entity';

function n(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estadoObligacion(saldoPendiente: number, montoOriginal: number): string {
  if (saldoPendiente <= 0.000001) return 'pagada';
  if (saldoPendiente + 0.000001 < montoOriginal) return 'parcial';
  return 'pendiente';
}

@Injectable()
export class ProveedorPagoRevertirService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Pago) private readonly pagoRepo: Repository<Pago>,
    @InjectRepository(CuentaCorriente) private readonly cuentaRepo: Repository<CuentaCorriente>,
    @InjectRepository(PagoProveedorMovimiento)
    private readonly movimientoRepo: Repository<PagoProveedorMovimiento>,
    @InjectRepository(PagoProveedorFactura)
    private readonly obligacionRepo: Repository<PagoProveedorFactura>,
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async revertir(proveedorId: string, pagoId: string) {
    await this.assertStock();
    await this.assertProveedor(proveedorId);
    const tenantId = this.tenantContext.getTenantId();

    const pago = await this.pagoRepo.findOne({ where: { id: pagoId, tenantId, proveedorId } });
    if (!pago) throw new NotFoundException('Pago de proveedor no encontrado');

    const cuenta = await this.cuentaRepo.findOne({
      where: { id: pago.cuentaId, tenantId, proveedorId },
    });
    if (!cuenta) throw new NotFoundException('Cuenta corriente de proveedor no encontrada');

    await this.dataSource.query(
      `SELECT public.revertir_movimiento_tesoreria_por_pago($1::uuid, $2::uuid)`,
      [tenantId, pago.id],
    );

    const movimientosPorPago = await this.movimientoRepo.find({
      where: { tenantId, pagoCuentaCorrienteId: pago.id },
    });

    if (movimientosPorPago.length > 1) {
      return this.revertirPagoMultiple(tenantId, proveedorId, pago, cuenta, movimientosPorPago);
    }

    let movimiento = movimientosPorPago[0] ?? null;
    let obligacion: PagoProveedorFactura | null = null;

    if (!movimiento && pago.comprobanteId) {
      obligacion = await this.obligacionRepo.findOne({
        where: { tenantId, proveedorId, comprobanteId: pago.comprobanteId },
      });
      if (obligacion) {
        const foundMov = await this.buscarMovimientoPorMetadata(
          tenantId,
          obligacion.id,
          pago,
          true,
        );
        if (!foundMov) {
          throw new ConflictException('No se pudo vincular el pago con su movimiento de factura');
        }
        movimiento = foundMov;
      }
    }

    if (movimiento) {
      if (movimiento.reciboComprobanteId) {
        throw new ConflictException(
          'El pago tiene recibo asociado. Anula ese recibo antes de revertir el pago',
        );
      }
      obligacion =
        obligacion ??
        (await this.obligacionRepo.findOne({
          where: { tenantId, id: movimiento.pagoProveedorFacturaId },
        }));
      if (!obligacion) throw new NotFoundException('Obligacion a proveedor no encontrada');
      if (obligacion.estado === 'anulada') {
        throw new ConflictException('La obligacion asociada esta anulada');
      }

      const restantes = await this.movimientoRepo.find({
        where: { tenantId, pagoProveedorFacturaId: obligacion.id },
      });
      const totalRestante = restantes
        .filter((m) => m.id !== movimiento!.id)
        .reduce((acc, row) => acc + n(row.monto), 0);
      const saldoNuevo = Math.max(n(obligacion.montoOriginal) - totalRestante, 0);

      await this.movimientoRepo.delete({ tenantId, id: movimiento.id });
      await this.obligacionRepo.update(
        { id: obligacion.id, tenantId },
        {
          saldoPendiente: saldoNuevo.toFixed(6),
          estado: estadoObligacion(saldoNuevo, n(obligacion.montoOriginal)),
        },
      );
    }

    const saldoCuentaNuevo = n(cuenta.saldo) + n(pago.monto);
    await this.cuentaRepo.update({ id: cuenta.id, tenantId }, { saldo: saldoCuentaNuevo.toFixed(6) });
    await this.pagoRepo.delete({ tenantId, id: pago.id });

    return {
      resultado: {
        pago_id: pago.id,
        proveedor_id: proveedorId,
        monto_revertido: n(pago.monto),
        saldo_cuenta_nuevo: saldoCuentaNuevo,
        obligacion_id: obligacion?.id ?? null,
        movimiento_revertido_id: movimiento?.id ?? null,
      },
    };
  }

  private async revertirPagoMultiple(
    tenantId: string,
    proveedorId: string,
    pago: Pago,
    cuenta: CuentaCorriente,
    movimientosPorPago: PagoProveedorMovimiento[],
  ) {
    if (movimientosPorPago.some((m) => m.reciboComprobanteId)) {
      throw new ConflictException(
        'El pago tiene recibo asociado. Anula ese recibo antes de revertir el pago',
      );
    }

    const obligacionIds = [...new Set(movimientosPorPago.map((m) => m.pagoProveedorFacturaId))];
    const obligaciones = await this.obligacionRepo.find({
      where: { tenantId, proveedorId, id: In(obligacionIds) },
    });
    if (obligaciones.length !== obligacionIds.length) {
      throw new NotFoundException('Una o mas obligaciones asociadas al pago no fueron encontradas');
    }
    if (obligaciones.some((o) => o.estado === 'anulada')) {
      throw new ConflictException('Una obligacion asociada esta anulada');
    }

    const movimientoIds = movimientosPorPago.map((m) => m.id);
    const todosMovs = await this.movimientoRepo.find({
      where: { tenantId, pagoProveedorFacturaId: In(obligacionIds) },
    });
    const revertidos = new Set(movimientoIds);
    const restantes = todosMovs.filter((m) => !revertidos.has(m.id));

    await this.movimientoRepo.delete({ tenantId, id: In(movimientoIds) });

    for (const obl of obligaciones) {
      const totalRestante = restantes
        .filter((m) => m.pagoProveedorFacturaId === obl.id)
        .reduce((acc, row) => acc + n(row.monto), 0);
      const saldoNuevo = Math.max(n(obl.montoOriginal) - totalRestante, 0);
      await this.obligacionRepo.update(
        { id: obl.id, tenantId },
        {
          saldoPendiente: saldoNuevo.toFixed(6),
          estado: estadoObligacion(saldoNuevo, n(obl.montoOriginal)),
        },
      );
    }

    const saldoCuentaNuevo = n(cuenta.saldo) + n(pago.monto);
    await this.cuentaRepo.update({ id: cuenta.id, tenantId }, { saldo: saldoCuentaNuevo.toFixed(6) });
    await this.pagoRepo.delete({ tenantId, id: pago.id });

    return {
      resultado: {
        pago_id: pago.id,
        proveedor_id: proveedorId,
        monto_revertido: n(pago.monto),
        saldo_cuenta_nuevo: saldoCuentaNuevo,
        obligaciones_revertidas: obligaciones.map((o) => o.id),
        movimientos_revertidos: movimientoIds,
      },
    };
  }

  private async buscarMovimientoPorMetadata(
    tenantId: string,
    obligacionId: string,
    pago: Pago,
    sinPagoCc: boolean,
  ): Promise<PagoProveedorMovimiento | null> {
    const qb = this.movimientoRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.pago_proveedor_factura_id = :obligacionId', { obligacionId })
      .andWhere('m.monto = :monto', { monto: pago.monto })
      .andWhere('m.tipo_pago = :tipoPago', { tipoPago: pago.tipoPago })
      .andWhere('m.fecha = :fecha', { fecha: pago.fecha });
    if (sinPagoCc) qb.andWhere('m.pago_cuenta_corriente_id IS NULL');
    if (pago.usuarioId) qb.andWhere('m.usuario_id = :usuarioId', { usuarioId: pago.usuarioId });
    else qb.andWhere('m.usuario_id IS NULL');
    if (pago.notas) qb.andWhere('m.notas = :notas', { notas: pago.notas });
    else qb.andWhere('m.notas IS NULL');

    const candidatos = await qb.getMany();
    if (candidatos.length === 0) return null;
    if (candidatos.length > 1) {
      throw new ConflictException(
        'Hay varios movimientos compatibles con este pago. No se puede revertir con seguridad',
      );
    }
    return candidatos[0] ?? null;
  }

  private async assertProveedor(proveedorId: string): Promise<void> {
    const ok = await this.proveedorRepo.exist({
      where: { id: proveedorId, tenantId: this.tenantContext.getTenantId() },
    });
    if (!ok) throw new NotFoundException('Proveedor no encontrado');
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
