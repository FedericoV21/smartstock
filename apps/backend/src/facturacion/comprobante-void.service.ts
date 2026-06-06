import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { ReferenciaTipo } from '../inventory/enums/referencia-tipo.enum';
import { TipoMovimiento } from '../inventory/enums/tipo-movimiento.enum';
import { REGISTRAR_MOVIMIENTO_SQL } from '../inventory/sql/registrar-movimiento.sql';
import { REGISTRAR_MOVIMIENTO_VARIANTE_SQL } from '../inventory/sql/registrar-movimiento-variante.sql';
import { ProductoVarianteStockSucursal } from '../products/entities/producto-variante-stock-sucursal.entity';
import { ComprobanteItem } from './entities/comprobante-item.entity';
import { Comprobante } from './entities/comprobante.entity';
import { FacturaImportadaAplicacion } from './entities/factura-importada-aplicacion.entity';
import { EstadoComprobante } from './enums/estado-comprobante.enum';
import { TipoComprobante } from './enums/tipo-comprobante.enum';
import {
  caeAfipFormatoValido,
  formatearTipoComprobante,
  MOTIVO_MOVIMIENTO_USER_MAX,
  puedeAnularComprobanteInterno,
  validarMotivoAnulacion,
} from './utils/comprobante-void.rules';

export type ReversionFacturaImportadaResumen = {
  stockMovimientosRevertidos: number;
  cuentaCorrienteRevertida: number;
  cuentaCorrienteAjusteNeto: number;
  obligacionesProveedorAnuladas: number;
  productosRestaurados: number;
  productosDesactivados: number;
  productosOmitidos: number;
};

@Injectable()
export class ComprobanteVoidService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem)
    private readonly itemRepo: Repository<ComprobanteItem>,
    @InjectRepository(Movimiento)
    private readonly movimientoRepo: Repository<Movimiento>,
    @InjectRepository(FacturaImportadaAplicacion)
    private readonly aplicacionRepo: Repository<FacturaImportadaAplicacion>,
    @InjectRepository(StockSucursal)
    private readonly stockRepo: Repository<StockSucursal>,
    @InjectRepository(ProductoVarianteStockSucursal)
    private readonly varianteStockRepo: Repository<ProductoVarianteStockSucursal>,
    private readonly tenantContext: TenantContext,
    private readonly branchStockService: BranchStockService,
  ) {}

  async anularSinCae(comprobanteId: string, motivoRaw: string, usuarioId: string) {
    const motivoVal = validarMotivoAnulacion(motivoRaw);
    if (!motivoVal.ok) {
      throw new BadRequestException(motivoVal.error);
    }

    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!comp) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    const regla = puedeAnularComprobanteInterno({
      estado: comp.estado,
      tipo: comp.tipo,
      cae: comp.cae,
      tipoOperacion: comp.tipoOperacion,
    });
    if (!regla.ok) {
      throw new BadRequestException(regla.error);
    }

    if (comp.cae != null && caeAfipFormatoValido(comp.cae)) {
      throw new BadRequestException(
        'El comprobante ya tiene CAE AFIP v├ílido. Us├í el flujo de nota de cr├®dito.',
      );
    }

    const sucursalId =
      comp.sucursalId ?? (await this.branchStockService.resolveDepotId());

    const motivoMovUser =
      motivoVal.motivo.length > MOTIVO_MOVIMIENTO_USER_MAX
        ? `${motivoVal.motivo.slice(0, MOTIVO_MOVIMIENTO_USER_MAX)}ÔÇª`
        : motivoVal.motivo;

    const items = await this.itemRepo.find({ where: { comprobanteId } });
    const esPresupuesto = comp.tipo === TipoComprobante.presupuesto;
    const esReingreso = comp.tipo.startsWith('nota_credito');

    if (!esPresupuesto) {
      const movTipo = esReingreso ? TipoMovimiento.salida : TipoMovimiento.entrada;
      for (const it of items) {
        await this.dataSource.query(REGISTRAR_MOVIMIENTO_SQL, [
          tenantId,
          it.productoId,
          sucursalId,
          movTipo,
          Number(it.cantidad),
          `Anula ${formatearTipoComprobante(comp.tipo)} (reverso interno) ┬À ${comprobanteId.slice(0, 8)}ÔÇª ÔÇö ${motivoMovUser}`,
          'factura',
          comprobanteId,
          usuarioId,
        ]);
      }
    }

    const anuladoAt = new Date();
    await this.comprobanteRepo.update(
      { id: comprobanteId, tenantId },
      {
        estado: EstadoComprobante.anulado,
        pdfUrl: null,
        motivoAnulacion: motivoVal.motivo,
        anuladoAt,
        anuladoPor: usuarioId,
      },
    );

    return { data: { ok: true } };
  }

  async revertirImportada(
    comprobanteId: string,
    motivoRaw: string,
    usuarioId: string,
  ) {
    const motivoVal = validarMotivoAnulacion(motivoRaw);
    if (!motivoVal.ok) {
      throw new BadRequestException(motivoVal.error);
    }

    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!comp) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    if (comp.tipoOperacion !== 'compra' || comp.estado !== EstadoComprobante.importado) {
      throw new BadRequestException(
        'Solo se pueden revertir compras importadas que a├║n est├®n en estado importado.',
      );
    }

    const aplicacion = await this.aplicacionRepo.findOne({
      where: { tenantId, comprobanteId },
    });
    if (aplicacion?.estado === 'revertida') {
      throw new ConflictException('Esta factura importada ya fue revertida.');
    }

    const movimientos = await this.movimientoRepo.find({
      where: {
        tenantId,
        referenciaId: comprobanteId,
        tipo: TipoMovimiento.entrada,
        referenciaTipo: In([
          ReferenciaTipo.factura_recibida,
          ReferenciaTipo.factura_importada,
        ]),
      },
    });

    const debeRevertirStock = aplicacion ? aplicacion.afectaStock : movimientos.length > 0;

    if (debeRevertirStock) {
      for (const mov of movimientos) {
        const stock = await this.stockActual(tenantId, mov);
        if (stock + 0.000001 < Number(mov.cantidad)) {
          throw new ConflictException(
            'No hay stock suficiente para revertir la entrada completa. Ajust├í el stock o revis├í movimientos posteriores.',
          );
        }
      }
    }

    const resumen: ReversionFacturaImportadaResumen = {
      stockMovimientosRevertidos: 0,
      cuentaCorrienteRevertida: 0,
      cuentaCorrienteAjusteNeto: 0,
      obligacionesProveedorAnuladas: 0,
      productosRestaurados: 0,
      productosDesactivados: 0,
      productosOmitidos: 0,
    };

    if (debeRevertirStock) {
      for (const mov of movimientos) {
        const sucursalId =
          mov.sucursalId ?? comp.sucursalId ?? (await this.branchStockService.resolveDepotId());
        const motivo = `Reversion factura importada ${comprobanteId.slice(0, 8)} - ${motivoVal.motivo}`;

        if (mov.productoVarianteId) {
          await this.dataSource.query(REGISTRAR_MOVIMIENTO_VARIANTE_SQL, [
            tenantId,
            mov.productoId,
            mov.productoVarianteId,
            sucursalId,
            TipoMovimiento.salida,
            Number(mov.cantidad),
            motivo,
            mov.referenciaTipo,
            comprobanteId,
            usuarioId,
          ]);
        } else {
          await this.dataSource.query(REGISTRAR_MOVIMIENTO_SQL, [
            tenantId,
            mov.productoId,
            sucursalId,
            TipoMovimiento.salida,
            Number(mov.cantidad),
            motivo,
            mov.referenciaTipo ?? 'factura_recibida',
            comprobanteId,
            usuarioId,
          ]);
        }
        resumen.stockMovimientosRevertidos += 1;
      }
    }

    const anuladoAt = new Date();
    await this.comprobanteRepo.update(
      { id: comprobanteId, tenantId },
      {
        estado: EstadoComprobante.anulado,
        pdfUrl: null,
        motivoAnulacion: motivoVal.motivo,
        anuladoAt,
        anuladoPor: usuarioId,
      },
    );

    if (aplicacion) {
      await this.aplicacionRepo.update(
        { id: aplicacion.id, tenantId },
        {
          estado: 'revertida',
          revertidaAt: anuladoAt,
          revertidaPor: usuarioId,
          motivoReversion: motivoVal.motivo,
          resumenReversion: { ...resumen },
        },
      );
    }

    return { data: { ok: true, resumen } };
  }

  private async stockActual(tenantId: string, mov: Movimiento): Promise<number> {
    if (mov.productoVarianteId && mov.sucursalId) {
      const row = await this.varianteStockRepo.findOne({
        where: {
          tenantId,
          productoId: mov.productoId,
          varianteId: mov.productoVarianteId,
          sucursalId: mov.sucursalId,
        },
      });
      return Number(row?.stockActual ?? 0);
    }
    if (mov.sucursalId) {
      const row = await this.stockRepo.findOne({
        where: { tenantId, productoId: mov.productoId, sucursalId: mov.sucursalId },
      });
      return Number(row?.stockActual ?? 0);
    }
    return 0;
  }
}
