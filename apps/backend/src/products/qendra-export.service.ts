import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { Categoria } from '../catalog/entities/categoria.entity';
import { UsersService } from '../users/users.service';
import { ExportQendraBalanzaDto } from './dto/export-qendra-balanza.dto';
import { Producto } from './entities/producto.entity';
import {
  dedupeProductosPorId,
  filasQendraBalanzaACsv,
  productoAFilaQendraBalanza,
  productoEsExportableQendraBalanza,
} from './utils/export-qendra-balanza';

const CHUNK = 500;
const MAX_FILAS = 5000;
const QENDRA_EXPORT_FILENAME = 'qendra.csv';

type ProductoExportRow = {
  id: string;
  codigo: string;
  nombre: string;
  precioVenta: string;
  plu: string | null;
  esPesable: boolean;
  unidad: string;
  fechaVencimiento: string | null;
  descripcion: string | null;
  categoriaId: string | null;
  categoriaNombre: string | null;
};

@Injectable()
export class QendraExportService {
  constructor(
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  async exportCsv(dto: ExportQendraBalanzaDto, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const categoriaIds = [...new Set(dto.categoriaIds ?? [])];
    const productoIds = [...new Set(dto.productoIds ?? [])];
    const sectorFijo = dto.sectorFijo?.trim() || null;

    if (categoriaIds.length === 0 && productoIds.length === 0) {
      throw new BadRequestException(
        'Eleg├¡ al menos una categor├¡a o uno o m├ís productos para exportar.',
      );
    }

    const appRole = resolveAppRole(user);
    const sucursalIds = await this.usersService.listOperableSucursalIds(
      user.sub,
      tenantId,
      appRole,
    );
    if (sucursalIds.length === 0) {
      throw new ForbiddenException('No ten├®s sucursales asignadas para exportar el cat├ílogo.');
    }

    const categoriasPorId = await this.loadCategoriasMap(tenantId, categoriaIds);
    let acum: ProductoExportRow[] = [];

    if (productoIds.length > 0) {
      if (productoIds.length > MAX_FILAS) {
        throw new BadRequestException(
          `Demasiados productos (${productoIds.length}). M├íximo ${MAX_FILAS}.`,
        );
      }
      for (let i = 0; i < productoIds.length; i += CHUNK) {
        const lote = productoIds.slice(i, i + CHUNK);
        acum.push(...(await this.fetchExportables(tenantId, sucursalIds, { productoIds: lote })));
      }
    }

    if (categoriaIds.length > 0) {
      const count = await this.countExportables(tenantId, sucursalIds, categoriaIds);
      if (acum.length + count > MAX_FILAS) {
        throw new BadRequestException(
          `Hay demasiados productos (${acum.length + count}). El m├íximo por exportaci├│n es ${MAX_FILAS}.`,
        );
      }
      for (let offset = 0; offset < count; offset += CHUNK) {
        acum.push(
          ...(await this.fetchExportables(tenantId, sucursalIds, {
            categoriaIds,
            offset,
            limit: CHUNK,
          })),
        );
      }
    }

    acum = dedupeProductosPorId(acum);
    acum.sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
    );

    if (acum.length === 0) {
      throw new NotFoundException(
        'No hay productos exportables con PLU (pesables o por unidad con PLU). Revis├í que est├®n activos y tengan PLU.',
      );
    }

    const filasCsv = acum.map((p) =>
      productoAFilaQendraBalanza({
        plu: p.plu,
        nombre: p.nombre,
        precioVenta: Number(p.precioVenta),
        sector: this.sectorDeProducto(p, sectorFijo, categoriasPorId),
        esPesable: p.esPesable,
        unidad: p.unidad,
        fechaVencimiento: p.fechaVencimiento,
        ingredientes: p.descripcion,
        descuentoPct: null,
      }),
    );

    const csv = filasQendraBalanzaACsv(filasCsv);
    const buffer = Buffer.from(csv, 'utf8');

    return new StreamableFile(buffer, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${QENDRA_EXPORT_FILENAME}"`,
    });
  }

  private async loadCategoriasMap(tenantId: string, categoriaIds: string[]) {
    const map = new Map<string, string>();
    if (categoriaIds.length === 0) return map;

    const cats = await this.categoriaRepo.find({
      where: { tenantId, id: In(categoriaIds) },
    });
    const activas = cats.filter((c) => c.activa);
    if (activas.length !== categoriaIds.length) {
      throw new NotFoundException('Una o m├ís categor├¡as no existen o est├ín inactivas.');
    }
    for (const c of activas) {
      map.set(c.id, c.nombre);
    }
    return map;
  }

  private baseQb(tenantId: string, sucursalIds: string[]) {
    return this.productoRepo
      .createQueryBuilder('p')
      .leftJoin(Categoria, 'c', 'c.id = p.categoria_id AND c.tenant_id = p.tenant_id')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.activo = true')
      .andWhere('p.plu IS NOT NULL')
      .andWhere("btrim(p.plu) <> ''")
      .andWhere('(p.es_pesable = true OR (p.es_pesable = false AND p.unidad = :unidad))', {
        unidad: 'unidad',
      })
      .andWhere('p.sucursal_id IN (:...sucursalIds)', { sucursalIds });
  }

  private async countExportables(
    tenantId: string,
    sucursalIds: string[],
    categoriaIds: string[],
  ) {
    const row = await this.baseQb(tenantId, sucursalIds)
      .andWhere('p.categoria_id IN (:...categoriaIds)', { categoriaIds })
      .select('COUNT(DISTINCT p.id)', 'n')
      .getRawOne<{ n: string }>();
    return Number(row?.n ?? 0);
  }

  private async fetchExportables(
    tenantId: string,
    sucursalIds: string[],
    opts: {
      productoIds?: string[];
      categoriaIds?: string[];
      offset?: number;
      limit?: number;
    },
  ): Promise<ProductoExportRow[]> {
    const qb = this.baseQb(tenantId, sucursalIds)
      .select([
        'p.id AS id',
        'p.codigo AS codigo',
        'p.nombre AS nombre',
        'p.precio_venta AS precio_venta',
        'p.plu AS plu',
        'p.es_pesable AS es_pesable',
        'p.unidad AS unidad',
        'p.fecha_vencimiento AS fecha_vencimiento',
        'p.descripcion AS descripcion',
        'p.categoria_id AS categoria_id',
        'c.nombre AS categoria_nombre',
      ])
      .orderBy('p.nombre', 'ASC');

    if (opts.productoIds?.length) {
      qb.andWhere('p.id IN (:...productoIds)', { productoIds: opts.productoIds });
    }
    if (opts.categoriaIds?.length) {
      qb.andWhere('p.categoria_id IN (:...categoriaIds)', { categoriaIds: opts.categoriaIds });
    }
    if (opts.offset != null) {
      qb.offset(opts.offset);
    }
    if (opts.limit != null) {
      qb.limit(opts.limit);
    }

    const rows = await qb.getRawMany<{
      id: string;
      codigo: string;
      nombre: string;
      precio_venta: string;
      plu: string | null;
      es_pesable: boolean;
      unidad: string;
      fecha_vencimiento: string | null;
      descripcion: string | null;
      categoria_id: string | null;
      categoria_nombre: string | null;
    }>();

    return rows
      .filter((r) =>
        productoEsExportableQendraBalanza({
          plu: r.plu,
          esPesable: r.es_pesable,
          unidad: r.unidad,
        }),
      )
      .map((r) => ({
        id: r.id,
        codigo: r.codigo,
        nombre: r.nombre,
        precioVenta: r.precio_venta,
        plu: r.plu,
        esPesable: r.es_pesable,
        unidad: r.unidad,
        fechaVencimiento: r.fecha_vencimiento,
        descripcion: r.descripcion,
        categoriaId: r.categoria_id,
        categoriaNombre: r.categoria_nombre,
      }));
  }

  private sectorDeProducto(
    p: ProductoExportRow,
    sectorFijo: string | null,
    categoriasPorId: Map<string, string>,
  ): string {
    if (sectorFijo) return sectorFijo;
    if (p.categoriaNombre) return p.categoriaNombre;
    if (p.categoriaId && categoriasPorId.has(p.categoriaId)) {
      return categoriasPorId.get(p.categoriaId)!;
    }
    return 'GENERAL';
  }
}
