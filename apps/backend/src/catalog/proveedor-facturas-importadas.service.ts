import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { FacturaImportadaAplicacion } from '../facturacion/entities/factura-importada-aplicacion.entity';
import { FacturasImportadasQueryDto } from './dto/facturas-importadas-query.dto';
import { Proveedor } from './entities/proveedor.entity';

export const FACTURAS_IMPORTADAS_POR_PAGINA = 10;

@Injectable()
export class ProveedorFacturasImportadasService {
  constructor(
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(FacturaImportadaAplicacion)
    private readonly aplicacionRepo: Repository<FacturaImportadaAplicacion>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async listFacturasImportadas(proveedorId: string, query: FacturasImportadasQueryDto) {
    await this.assertStockModuleEnabled();

    const tenantId = this.tenantContext.getTenantId();
    const proveedor = await this.proveedorRepo.findOne({ where: { id: proveedorId, tenantId } });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');

    const paginaSolicitada = query.pagina ?? 1;
    const total = await this.comprobanteRepo.count({
      where: { tenantId, proveedorId, tipoOperacion: 'compra' },
    });

    const totalPaginas = Math.max(1, Math.ceil(total / FACTURAS_IMPORTADAS_POR_PAGINA));
    const pagina = Math.min(Math.max(1, paginaSolicitada), totalPaginas);
    const skip = (pagina - 1) * FACTURAS_IMPORTADAS_POR_PAGINA;

    const facturasRaw = await this.comprobanteRepo.find({
      where: { tenantId, proveedorId, tipoOperacion: 'compra' },
      select: {
        id: true,
        tipo: true,
        numero: true,
        numeroOrden: true,
        fecha: true,
        total: true,
        estado: true,
        createdAt: true,
      },
      order: { fecha: 'DESC', createdAt: 'DESC' },
      skip,
      take: FACTURAS_IMPORTADAS_POR_PAGINA,
    });

    const facturasIds = facturasRaw.map((f) => f.id);
    const aplicacionesPorComprobante = new Map<
      string,
      { origen: 'lector' | 'manual'; estado: 'aplicada' | 'revertida' }
    >();

    if (facturasIds.length > 0) {
      const aplicaciones = await this.aplicacionRepo.find({
        where: { tenantId, comprobanteId: In(facturasIds) },
        select: { comprobanteId: true, origen: true, estado: true },
      });
      for (const app of aplicaciones) {
        aplicacionesPorComprobante.set(app.comprobanteId, {
          origen: app.origen,
          estado: app.estado,
        });
      }
    }

    const facturas = facturasRaw.map((f) => {
      const aplicacion = aplicacionesPorComprobante.get(f.id);
      return {
        id: f.id,
        tipo: f.tipo,
        numero: f.numero,
        numero_orden: f.numeroOrden,
        fecha: f.fecha,
        total: Number(f.total),
        estado: f.estado,
        origen_importacion: aplicacion?.origen ?? null,
        estado_aplicacion: aplicacion?.estado ?? null,
      };
    });

    return {
      facturas,
      total,
      pagina,
      totalPaginas,
      porPagina: FACTURAS_IMPORTADAS_POR_PAGINA,
    };
  }

  private async assertStockModuleEnabled(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!modulos) {
      throw new ForbiddenException('Configuración de módulos no encontrada');
    }
    if (!modulos.stock) {
      throw new ForbiddenException('Módulo stock no habilitado');
    }
  }
}
