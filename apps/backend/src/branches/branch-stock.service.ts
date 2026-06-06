import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Producto } from '../products/entities/producto.entity';
import { CreateBranchStockDto } from './dto/create-branch-stock.dto';
import { ListBranchStockQueryDto } from './dto/list-branch-stock-query.dto';
import { UpdateBranchStockDto } from './dto/update-branch-stock.dto';
import { StockSucursal } from './entities/stock-sucursal.entity';
import { Sucursal } from './entities/sucursal.entity';
import { SucursalContext } from './sucursal-context.service';

@Injectable()
export class BranchStockService {
  constructor(
    @InjectRepository(StockSucursal)
    private readonly stockRepo: Repository<StockSucursal>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async resolveDepotId(productoId?: string): Promise<string> {
    const fromCtx = await this.sucursalContext.resolveSucursalId();
    if (fromCtx) return fromCtx;

    if (productoId) {
      const tenantId = this.tenantContext.getTenantId();
      const producto = await this.productoRepo.findOne({
        where: { id: productoId, tenantId },
        select: ['id', 'sucursalId'],
      });
      if (producto?.sucursalId) return producto.sucursalId;
    }

    const tenantId = this.tenantContext.getTenantId();
    const principal = await this.sucursalRepo.find({
      where: { tenantId, activa: true },
      order: { esPrincipal: 'DESC', createdAt: 'ASC' },
      take: 1,
    });
    if (principal[0]?.id) return principal[0].id;

    throw new BadRequestException(
      'Indic├í sucursalId (query/header X-Sucursal-Id) o asign├í sucursal al producto.',
    );
  }

  async listByBranch(query: ListBranchStockQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = query.sucursalId ?? (await this.resolveDepotId());
    await this.assertSucursal(tenantId, sucursalId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const [rows, total] = await this.stockRepo.findAndCount({
      where: { tenantId, sucursalId },
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const productIds = rows.map((r) => r.productoId);
    const productos =
      productIds.length > 0
        ? await this.productoRepo.find({
            where: { id: In(productIds), tenantId, activo: true },
          })
        : [];
    const productoMap = new Map(productos.map((p) => [p.id, p]));

    return {
      data: rows.map((row) => {
        const p = productoMap.get(row.productoId);
        return {
          ...this.serializeStock(row),
          producto: p
            ? {
                id: p.id,
                codigo: p.codigo,
                nombre: p.nombre,
                unidad: p.unidad,
              }
            : null,
        };
      }),
      meta: {
        sucursalId,
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async listForProduct(productoId: string) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProducto(productoId, tenantId);

    const rows = await this.stockRepo.find({
      where: { tenantId, productoId },
      order: { updatedAt: 'DESC' },
    });

    return { data: rows.map((r) => this.serializeStock(r)) };
  }

  async listAvailableBranches(productoId: string) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProducto(productoId, tenantId);

    const activas = await this.sucursalRepo.find({
      where: { tenantId, activa: true },
      order: { createdAt: 'ASC' },
    });
    const existing = await this.stockRepo.find({
      where: { tenantId, productoId },
      select: ['sucursalId'],
    });
    const conFila = new Set(existing.map((r) => r.sucursalId));
    const faltan = activas.filter((s) => !conFila.has(s.id));

    return {
      data: faltan.map((s) => ({
        id: s.id,
        codigo: s.codigo,
        nombre: s.nombre,
      })),
    };
  }

  async enableForProduct(productoId: string, dto: CreateBranchStockDto) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProducto(productoId, tenantId);
    await this.assertSucursal(tenantId, dto.sucursalId);

    const existing = await this.stockRepo.findOne({
      where: { tenantId, productoId, sucursalId: dto.sucursalId },
    });
    if (existing) {
      return {
        data: {
          ok: true,
          alreadyExisted: true,
          stock: this.serializeStock(existing),
        },
      };
    }

    try {
      const saved = await this.stockRepo.save(
        this.stockRepo.create({
          tenantId,
          productoId,
          sucursalId: dto.sucursalId,
          stockActual: '0.000',
          stockMinimo: '0.000',
          ubicacion: null,
        }),
      );
      return { data: { ok: true, alreadyExisted: false, stock: this.serializeStock(saved) } };
    } catch (err) {
      this.rethrowUnique(err);
      throw err;
    }
  }

  async updateForProduct(productoId: string, dto: UpdateBranchStockDto) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProducto(productoId, tenantId);

    const row = await this.stockRepo.findOne({
      where: { tenantId, productoId, sucursalId: dto.sucursalId },
    });
    if (!row) {
      throw new NotFoundException('No hay registro de stock para este producto en esa sucursal.');
    }

    if (dto.stockMinimo !== undefined) {
      row.stockMinimo = dto.stockMinimo.toFixed(3);
    }
    if (dto.ubicacion !== undefined) {
      row.ubicacion = dto.ubicacion?.trim() || null;
    }

    const saved = await this.stockRepo.save(row);
    return { data: this.serializeStock(saved) };
  }

  async materializeForTenant() {
    const tenantId = this.tenantContext.getTenantId();
    const rows = (await this.dataSource.query(
      `SELECT public.materializar_stock_sucursales_faltantes($1::uuid) AS n`,
      [tenantId],
    )) as { n: string }[];
    const created = Number(rows[0]?.n ?? 0);
    return {
      data: {
        created,
        message:
          created === 0
            ? 'No hab├¡a filas faltantes en stock_sucursal.'
            : `Se crearon ${created} registro(s) en stock_sucursal (existencias en 0).`,
      },
    };
  }

  async listStockBajoByBranch(sucursalId: string, limit: number) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertSucursal(tenantId, sucursalId);

    const rows = await this.stockRepo
      .createQueryBuilder('ss')
      .innerJoin(Producto, 'p', 'p.id = ss.producto_id AND p.tenant_id = ss.tenant_id')
      .where('ss.tenant_id = :tenantId', { tenantId })
      .andWhere('ss.sucursal_id = :sucursalId', { sucursalId })
      .andWhere('p.activo = true')
      .andWhere('ss.stock_actual <= ss.stock_minimo')
      .orderBy('p.nombre', 'ASC')
      .take(limit)
      .select([
        'ss.producto_id AS producto_id',
        'ss.stock_actual AS stock_actual',
        'ss.stock_minimo AS stock_minimo',
        'p.codigo AS codigo',
        'p.nombre AS nombre',
        'p.unidad AS unidad',
      ])
      .getRawMany<{
        producto_id: string;
        stock_actual: string;
        stock_minimo: string;
        codigo: string;
        nombre: string;
        unidad: string;
      }>();

    return rows.map((r) => ({
      id: r.producto_id,
      codigo: r.codigo,
      nombre: r.nombre,
      unidad: r.unidad,
      stockActual: Number(r.stock_actual),
      stockMinimo: Number(r.stock_minimo),
      deficit: Number(r.stock_minimo) - Number(r.stock_actual),
      sucursalId,
    }));
  }

  private async assertProducto(productoId: string, tenantId: string) {
    const ok = await this.productoRepo.exist({ where: { id: productoId, tenantId } });
    if (!ok) {
      throw new NotFoundException('Producto no encontrado');
    }
  }

  private async assertSucursal(tenantId: string, sucursalId: string) {
    const ok = await this.sucursalRepo.exist({
      where: { id: sucursalId, tenantId, activa: true },
    });
    if (!ok) {
      throw new NotFoundException('Sucursal no encontrada o inactiva.');
    }
  }

  private rethrowUnique(err: unknown): void {
    if (err instanceof QueryFailedError) {
      const code = (err.driverError as { code?: string })?.code;
      if (code === '23505') {
        throw new BadRequestException('Ya existe stock para ese producto en la sucursal.');
      }
    }
  }

  private serializeStock(row: StockSucursal) {
    return {
      id: row.id,
      productoId: row.productoId,
      sucursalId: row.sucursalId,
      stockActual: Number(row.stockActual),
      stockMinimo: Number(row.stockMinimo),
      ubicacion: row.ubicacion,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
