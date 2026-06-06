import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { Producto } from '../products/entities/producto.entity';
import { UsersService } from '../users/users.service';
import { resolverPeriodoReporte } from '../reports/utils/periodo-reporte.util';
import { round2 } from '../reports/utils/report-comprobante-rules.util';
import { aplanarRepresentativosVentaPorOrden } from '../reports/utils/ventas-representativas.util';

const ROLES_SIN_METRICAS = new Set(['operador', 'cajero']);

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(StockSucursal) private readonly stockSucursalRepo: Repository<StockSucursal>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  async getMetrics(user: AccessTokenPayload) {
    const role = resolveAppRole(user);
    if (!role || ROLES_SIN_METRICAS.has(role)) {
      throw new ForbiddenException('Sin permisos');
    }

    const tenantId = this.tenantContext.getTenantId();
    const periodo = resolverPeriodoReporte({ periodo: 'mes' });
    const { desde, hasta } = periodo;

    const operableIds = await this.usersService.listOperableSucursalIds(user.sub, tenantId, role);

    const [productosActivos, comprobantesMes, comprobantesVentas, valorInventario] = await Promise.all([
      this.productoRepo.count({ where: { tenantId, activo: true } }),
      this.comprobanteRepo.count({
        where: {
          tenantId,
          estado: EstadoComprobante.emitido,
          fecha: Between(desde, hasta),
        },
      }),
      this.comprobanteRepo.find({
        where: {
          tenantId,
          estado: EstadoComprobante.emitido,
          fecha: Between(desde, hasta),
        },
        select: { id: true, total: true, tipo: true, numeroOrden: true },
      }),
      this.calcValorInventario(tenantId, operableIds),
    ]);

    const ventasFilas = aplanarRepresentativosVentaPorOrden(
      comprobantesVentas.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        numeroOrden: c.numeroOrden,
        total: Number(c.total),
      })),
    );

    let ventasMes = 0;
    for (const row of ventasFilas) {
      if (row.tipo === TipoComprobante.presupuesto) continue;
      const t = Number(row.total);
      if (row.tipo.startsWith('nota_credito')) ventasMes -= t;
      else ventasMes += t;
    }

    return {
      data: {
        productos_activos: productosActivos,
        valor_inventario: valorInventario,
        comprobantes_mes: comprobantesMes,
        ventas_mes: round2(ventasMes),
        periodo: { desde, hasta },
      },
    };
  }

  private async calcValorInventario(tenantId: string, operableIds: string[]): Promise<number> {
    if (operableIds.length === 0) return 0;

    const rows = await this.stockSucursalRepo
      .createQueryBuilder('ss')
      .innerJoin(Producto, 'p', 'p.id = ss.producto_id')
      .where('ss.tenant_id = :tenantId', { tenantId })
      .andWhere('ss.sucursal_id IN (:...operableIds)', { operableIds })
      .andWhere('p.activo = true')
      .select(['ss.stock_actual AS stock_actual', 'p.precio_costo AS precio_costo'])
      .getRawMany<{ stock_actual: string; precio_costo: string }>();

    let total = 0;
    for (const row of rows) {
      total += Number(row.stock_actual) * Number(row.precio_costo);
    }
    return round2(total);
  }
}
