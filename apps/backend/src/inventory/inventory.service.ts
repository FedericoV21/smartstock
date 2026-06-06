import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { Producto } from '../products/entities/producto.entity';
import { REGISTRAR_MOVIMIENTO_SQL } from './sql/registrar-movimiento.sql';
import { REGISTRAR_MOVIMIENTO_VARIANTE_SQL } from './sql/registrar-movimiento-variante.sql';
import { CreateMovimientoDto } from './dto/create-movimiento.dto';
import { ListAlertasQueryDto } from './dto/list-alertas-query.dto';
import { ListMovimientosQueryDto } from './dto/list-movimientos-query.dto';
import { ListVencimientosAlertasQueryDto } from './dto/list-vencimientos-alertas-query.dto';
import { Movimiento } from './entities/movimiento.entity';

@Injectable()
export class InventoryService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Movimiento)
    private readonly movimientoRepo: Repository<Movimiento>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    private readonly tenantContext: TenantContext,
    private readonly branchStockService: BranchStockService,
  ) {}

  async listStockBajoAlertas(query: ListAlertasQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const limit = query.limit ?? 100;

    const sucursalId =
      query.sucursalId ?? (await this.branchStockService.resolveDepotId().catch(() => null));
    if (sucursalId) {
      const data = await this.branchStockService.listStockBajoByBranch(sucursalId, limit);
      return { data, meta: { count: data.length, limit, sucursalId } };
    }

    const rows = await this.productoRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.activo = true')
      .andWhere('p.stock_actual <= p.stock_minimo')
      .orderBy('p.nombre', 'ASC')
      .take(limit)
      .getMany();

    return {
      data: rows.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        unidad: p.unidad,
        stockActual: Number(p.stockActual),
        stockMinimo: Number(p.stockMinimo),
        deficit: Number(p.stockMinimo) - Number(p.stockActual),
      })),
      meta: { count: rows.length, limit },
    };
  }

  async listVencimientosAlertas(query: ListVencimientosAlertasQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const limit = query.limit ?? 100;
    const dias = query.dias ?? 30;
    const endStr = addUtcDaysToDateString(utcTodayDateString(), dias);

    const rows = await this.productoRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.activo = true')
      .andWhere('p.fecha_vencimiento IS NOT NULL')
      .andWhere('p.fecha_vencimiento <= :end', { end: endStr })
      .orderBy('p.fecha_vencimiento', 'ASC')
      .take(limit)
      .getMany();

    return {
      data: rows.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        unidad: p.unidad,
        stockActual: Number(p.stockActual),
        fechaVencimiento: p.fechaVencimiento,
        vencido:
          p.fechaVencimiento !== null && p.fechaVencimiento <= utcTodayDateString(),
      })),
      meta: { count: rows.length, limit, dias },
    };
  }

  async listMovimientos(query: ListMovimientosQueryDto) {
    const tenantId = this.tenantContext.getTenantId();

    if (query.fechaDesde && query.fechaHasta && query.fechaDesde > query.fechaHasta) {
      throw new BadRequestException('fechaDesde no puede ser posterior a fechaHasta');
    }

    if (query.productoId) {
      const productoOk = await this.productoRepo.exist({
        where: { id: query.productoId, tenantId },
      });
      if (!productoOk) {
        throw new BadRequestException('productoId no pertenece al tenant');
      }
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.movimientoRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId });

    if (query.tipo) {
      qb.andWhere('m.tipo = :tipo', { tipo: query.tipo });
    }
    if (query.productoId) {
      qb.andWhere('m.producto_id = :productoId', { productoId: query.productoId });
    }
    if (query.sucursalId) {
      qb.andWhere('m.sucursal_id = :sucursalId', { sucursalId: query.sucursalId });
    }
    if (query.fechaDesde) {
      qb.andWhere('m.created_at >= :desde', { desde: startOfUtcDay(query.fechaDesde) });
    }
    if (query.fechaHasta) {
      qb.andWhere('m.created_at <= :hasta', { hasta: endOfUtcDay(query.fechaHasta) });
    }

    qb.orderBy('m.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [rows, total] = await qb.getManyAndCount();

    return {
      data: rows.map((m) => this.serializeMovimientoEntity(m)),
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async registrarMovimiento(dto: CreateMovimientoDto, usuarioId: string) {
    const tenantId = this.tenantContext.getTenantId();

    const producto = await this.productoRepo.findOne({
      where: { id: dto.productoId, tenantId, activo: true },
      select: ['id', 'usaVariantes'],
    });
    if (!producto) {
      throw new NotFoundException('Producto no encontrado o inactivo');
    }

    const sucursalId =
      dto.sucursalId ?? (await this.branchStockService.resolveDepotId(dto.productoId));

    const useVariante = producto.usaVariantes || !!dto.productoVarianteId;
    if (producto.usaVariantes && !dto.productoVarianteId) {
      throw new BadRequestException(
        'Este producto usa variantes. Indic├í productoVarianteId para mover stock.',
      );
    }
    if (dto.productoVarianteId && !producto.usaVariantes) {
      throw new BadRequestException('Este producto no usa variantes.');
    }

    const params = useVariante
      ? [
          tenantId,
          dto.productoId,
          dto.productoVarianteId,
          sucursalId,
          dto.tipo,
          dto.cantidad,
          dto.motivo ?? null,
          dto.referenciaTipo ?? null,
          dto.referenciaId ?? null,
          usuarioId,
        ]
      : [
          tenantId,
          dto.productoId,
          sucursalId,
          dto.tipo,
          dto.cantidad,
          dto.motivo ?? null,
          dto.referenciaTipo ?? null,
          dto.referenciaId ?? null,
          usuarioId,
        ];

    const sql = useVariante ? REGISTRAR_MOVIMIENTO_VARIANTE_SQL : REGISTRAR_MOVIMIENTO_SQL;

    try {
      const rows = (await this.dataSource.query(sql, params)) as Record<string, unknown>[];
      const row = rows[0];
      if (!row) {
        throw new BadRequestException('registrar_movimiento no devolvi├│ fila');
      }
      return { data: this.serializeMovimientoRow(row) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Producto no encontrado')) {
        throw new NotFoundException('Producto no encontrado');
      }
      if (message.includes('Stock insuficiente')) {
        throw new BadRequestException(message);
      }
      if (message.includes('usa variantes') || message.includes('Variante')) {
        throw new BadRequestException(message);
      }
      throw err;
    }
  }

  private serializeMovimientoRow(row: Record<string, unknown>) {
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      productoId: row.producto_id as string,
      productoVarianteId: (row.producto_variante_id as string) ?? null,
      productoVarianteEtiqueta: (row.producto_variante_etiqueta as string) ?? null,
      sucursalId: (row.sucursal_id as string) ?? null,
      tipo: row.tipo as string,
      cantidad: num(row.cantidad),
      stockAnterior: num(row.stock_anterior),
      stockPosterior: num(row.stock_posterior),
      motivo: (row.motivo as string) ?? null,
      referenciaTipo: (row.referencia_tipo as string) ?? null,
      referenciaId: (row.referencia_id as string) ?? null,
      usuarioId: (row.usuario_id as string) ?? null,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    };
  }

  private serializeMovimientoEntity(m: Movimiento) {
    return {
      id: m.id,
      tenantId: m.tenantId,
      productoId: m.productoId,
      productoVarianteId: m.productoVarianteId,
      productoVarianteEtiqueta: m.productoVarianteEtiqueta,
      sucursalId: m.sucursalId,
      tipo: m.tipo,
      cantidad: Number(m.cantidad),
      stockAnterior: Number(m.stockAnterior),
      stockPosterior: Number(m.stockPosterior),
      motivo: m.motivo,
      referenciaTipo: m.referenciaTipo,
      referenciaId: m.referenciaId,
      usuarioId: m.usuarioId,
      createdAt: m.createdAt.toISOString(),
    };
  }
}

function startOfUtcDay(isoDate: string): Date {
  const [y, mo, d] = isoDate.split('T')[0].split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

function endOfUtcDay(isoDate: string): Date {
  const [y, mo, d] = isoDate.split('T')[0].split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
}

function utcTodayDateString(): string {
  const n = new Date();
  return n.toISOString().slice(0, 10);
}

/** Suma `dias` calendario a una fecha `YYYY-MM-DD` en UTC. */
function addUtcDaysToDateString(yyyyMmDd: string, dias: number): string {
  const [y, mo, d] = yyyyMmDd.split('-').map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}
