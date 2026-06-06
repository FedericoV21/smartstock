import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { REGISTRAR_MOVIMIENTO_SQL } from '../inventory/sql/registrar-movimiento.sql';
import { REGISTRAR_MOVIMIENTO_VARIANTE_SQL } from '../inventory/sql/registrar-movimiento-variante.sql';
import { Producto } from '../products/entities/producto.entity';
import { ListImportLogsQueryDto } from './dto/list-import-logs-query.dto';
import { ImportacionArchivo } from './entities/importacion-archivo.entity';
import { ImportacionLog } from './entities/importacion-log.entity';
import { ImportacionProductoSnapshot } from './entities/importacion-producto-snapshot.entity';
import {
  asPrecioSucursalSnapshots,
  asProductoImportSnapshot,
  productoUpdateFromSnapshot,
  resumenReversionHash,
} from './utils/import-product-snapshot.util';

export type RevertImportSummary = {
  logsReverted: number;
  snapshotsUsed: number;
  productosDesactivados: number;
  productosRestaurados: number;
  productosOmitidos: number;
  movimientosStockRevertidos: number;
  lotesAjustados: number;
  preciosSucursalRestaurados: number;
  preciosSucursalEliminados: number;
};

@Injectable()
export class ImportLogService {
  constructor(
    @InjectRepository(ImportacionLog)
    private readonly logRepo: Repository<ImportacionLog>,
    @InjectRepository(ImportacionArchivo)
    private readonly archivoRepo: Repository<ImportacionArchivo>,
    @InjectRepository(ImportacionProductoSnapshot)
    private readonly snapshotRepo: Repository<ImportacionProductoSnapshot>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async list(query: ListImportLogsQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    if (!sucursalId) {
      throw new BadRequestException('No hay sucursal operativa seleccionada.');
    }

    const limit = Math.min(200, Math.max(1, query.limit ?? 80));
    const qb = this.logRepo
      .createQueryBuilder('l')
      .where('l.tenant_id = :tenantId', { tenantId })
      .andWhere('(l.sucursal_id = :sucursalId OR l.sucursal_id IS NULL)', { sucursalId })
      .orderBy('l.created_at', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .take(limit);

    if (query.desde) {
      qb.andWhere('l.created_at >= :desde', { desde: `${query.desde}T00:00:00.000Z` });
    }
    if (query.hasta) {
      qb.andWhere('l.created_at <= :hasta', { hasta: `${query.hasta}T23:59:59.999Z` });
    }
    if (query.proveedorId === '__sin__') {
      qb.andWhere('l.proveedor_id IS NULL');
    } else if (query.proveedorId && /^[0-9a-f-]{36}$/i.test(query.proveedorId)) {
      qb.andWhere('l.proveedor_id = :proveedorId', { proveedorId: query.proveedorId });
    }

    const logs = await qb.getMany();
    const cargaIds = [
      ...new Set(logs.map((l) => l.cargaId).filter((id): id is string => Boolean(id))),
    ];
    const dbCargas = new Set<string>();
    if (cargaIds.length > 0) {
      const archivos = await this.archivoRepo.find({
        where: { tenantId, cargaId: In(cargaIds) },
        select: { cargaId: true },
      });
      for (const arc of archivos) dbCargas.add(arc.cargaId);
    }

    const mapped = await Promise.all(
      logs.map(async (log) => {
        const [proveedor, sucursal] = await Promise.all([
          log.proveedorId
            ? this.proveedorRepo.findOne({
                where: { id: log.proveedorId, tenantId },
                select: { nombre: true },
              })
            : Promise.resolve(null),
          log.sucursalId
            ? this.sucursalRepo.findOne({
                where: { id: log.sucursalId, tenantId },
                select: { id: true, nombre: true },
              })
            : Promise.resolve(null),
        ]);
        return {
          id: log.id,
          createdAt: log.createdAt.toISOString(),
          archivoNombre: log.archivoNombre,
          origen: log.origen,
          totalFilas: log.totalFilas,
          filasExitosas: log.filasExitosas,
          filasConError: log.filasConError,
          productosCreados: log.productosCreados,
          productosActualizados: log.productosActualizados,
          detalleErrores: log.detalleErrores,
          proveedorId: log.proveedorId,
          usuarioId: log.usuarioId,
          sucursalId: log.sucursalId,
          cargaId: log.cargaId,
          archivoStoragePath: log.archivoStoragePath,
          archivoMime: log.archivoMime,
          archivoTamano: log.archivoTamano != null ? Number(log.archivoTamano) : null,
          estado: log.estado,
          revertidaAt: log.revertidaAt?.toISOString() ?? null,
          revertidaPor: log.revertidaPor,
          motivoReversion: log.motivoReversion,
          resumenReversion: log.resumenReversion,
          proveedor: proveedor ? { nombre: proveedor.nombre } : null,
          sucursal: sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null,
          archivoDbDisponible: Boolean(log.cargaId && dbCargas.has(log.cargaId)),
        };
      }),
    );

    return { data: { logs: mapped } };
  }

  async downloadFile(id: string): Promise<StreamableFile | { data: { url: null; message: string } }> {
    const tenantId = this.tenantContext.getTenantId();
    const log = await this.logRepo.findOne({ where: { id, tenantId } });
    if (!log) throw new NotFoundException('Registro no encontrado');

    if (log.cargaId) {
      const archivo = await this.archivoRepo.findOne({
        where: { tenantId, cargaId: log.cargaId },
      });
      if (archivo?.archivoBytes?.length) {
        const nombre = archivo.archivoNombre ?? log.archivoNombre ?? 'importacion';
        const mime = archivo.archivoMime?.trim() || 'application/octet-stream';
        return new StreamableFile(archivo.archivoBytes, {
          type: mime,
          disposition: `attachment; filename="${nombre.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200)}"`,
        });
      }
    }

    if (!log.archivoStoragePath?.trim()) {
      throw new NotFoundException('Esta importaci├│n no tiene archivo guardado');
    }

    return {
      data: {
        url: null,
        message:
          'El archivo est├í en storage externo (listas-precios). Descarga v├¡a front Supabase hasta migrar storage.',
      },
    };
  }

  async revert(id: string, motivo: string | undefined, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    if (!sucursalId) {
      throw new BadRequestException('No hay sucursal operativa seleccionada.');
    }

    const base = await this.logRepo
      .createQueryBuilder('l')
      .where('l.id = :id', { id })
      .andWhere('l.tenant_id = :tenantId', { tenantId })
      .andWhere('(l.sucursal_id = :sucursalId OR l.sucursal_id IS NULL)', { sucursalId })
      .getOne();

    if (!base) throw new NotFoundException('Importacion no encontrada.');

    const logsQb = this.logRepo
      .createQueryBuilder('l')
      .where('l.tenant_id = :tenantId', { tenantId })
      .andWhere('(l.sucursal_id = :sucursalId OR l.sucursal_id IS NULL)', { sucursalId });

    if (base.cargaId) {
      logsQb.andWhere('l.carga_id = :cargaId', { cargaId: base.cargaId });
    } else {
      logsQb.andWhere('l.id = :id', { id });
    }

    const logs = await logsQb.getMany();
    if (logs.length === 0) throw new NotFoundException('Importacion no encontrada.');
    if (logs.some((l) => l.estado === 'revertida')) {
      throw new ConflictException('Esta carga ya fue revertida.');
    }

    const logIds = logs.map((l) => l.id);
    const esperados = logs.reduce(
      (acc, l) => acc + l.productosCreados + l.productosActualizados,
      0,
    );

    const snapshots = await this.snapshotRepo.find({
      where: { tenantId, importacionLogId: In(logIds) },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    if (esperados > 0 && snapshots.length === 0) {
      throw new ConflictException(
        'Esta importacion no tiene trazabilidad de reversion. Solo se pueden revertir cargas hechas desde la version nueva.',
      );
    }
    if (snapshots.length < esperados) {
      throw new ConflictException(
        'La trazabilidad de esta importacion esta incompleta. No se puede revertir automaticamente sin riesgo.',
      );
    }

    const motivoFinal = motivo?.trim() || 'Reversion manual desde historial de importaciones';
    const resumen: RevertImportSummary = {
      logsReverted: logs.length,
      snapshotsUsed: snapshots.length,
      productosDesactivados: 0,
      productosRestaurados: 0,
      productosOmitidos: 0,
      movimientosStockRevertidos: 0,
      lotesAjustados: 0,
      preciosSucursalRestaurados: 0,
      preciosSucursalEliminados: 0,
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const movimientoIds = [
        ...new Set(snapshots.map((s) => s.movimientoId).filter((mid): mid is string => Boolean(mid))),
      ];
      const movimientos = new Map<string, Record<string, unknown>>();
      if (movimientoIds.length > 0) {
        const rows = (await queryRunner.query(
          `SELECT id, producto_id, producto_variante_id, proveedor_id, sucursal_id, stock_anterior
           FROM public.movimiento
           WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, movimientoIds],
        )) as Record<string, unknown>[];
        for (const row of rows) movimientos.set(String(row.id), row);
      }

      for (const snap of snapshots) {
        const mov = snap.movimientoId ? movimientos.get(snap.movimientoId) : null;
        if (mov) {
          await this.revertirMovimientoStock(
            queryRunner,
            mov,
            snap.importacionLogId,
            motivoFinal,
            user.sub,
            tenantId,
          );
          resumen.movimientosStockRevertidos += 1;
        }

        if (snap.accion === 'created') {
          await this.desactivarProductoCreado(queryRunner, tenantId, snap.productoId);
          resumen.productosDesactivados += 1;
          continue;
        }

        const before = asProductoImportSnapshot(snap.productoBefore);
        if (!before) {
          resumen.productosOmitidos += 1;
          continue;
        }
        await this.restaurarProductoActualizado(queryRunner, tenantId, snap.productoId, before);
        resumen.productosRestaurados += 1;

        const precios = await this.restaurarPreciosSucursal(
          queryRunner,
          tenantId,
          snap.productoId,
          snap.precioSucursalBefore,
        );
        resumen.preciosSucursalRestaurados += precios.restored;
        resumen.preciosSucursalEliminados += precios.deleted;
      }

      const lotesResult = (await queryRunner.query(
        `UPDATE public.producto_lote_ingreso
         SET cantidad = 0
         WHERE tenant_id = $1 AND importacion_log_id = ANY($2::uuid[])
         RETURNING id`,
        [tenantId, logIds],
      )) as unknown[];
      resumen.lotesAjustados = Array.isArray(lotesResult) ? lotesResult.length : 0;

      const resumenConHash = { ...resumen, hash: resumenReversionHash(resumen) };
      await queryRunner.query(
        `UPDATE public.importacion_log
         SET estado = 'revertida',
             revertida_at = now(),
             revertida_por = $3,
             motivo_reversion = $4,
             resumen_reversion = $5::jsonb
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, logIds, user.sub, motivoFinal, JSON.stringify(resumenConHash)],
      );

      await queryRunner.commitTransaction();
      return { data: { ok: true, resumen } };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async revertirMovimientoStock(
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
    mov: Record<string, unknown>,
    importacionLogId: string,
    motivo: string,
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const short = (motivo.trim() || 'Reversion manual de importacion').slice(0, 120);
    const movMotivo = `Reversion importacion ${importacionLogId.slice(0, 8)} - ${short}`;
    const stockAnterior = Number(mov.stock_anterior ?? 0);

    if (mov.producto_variante_id) {
      await queryRunner.query(REGISTRAR_MOVIMIENTO_VARIANTE_SQL, [
        tenantId,
        mov.producto_id,
        mov.producto_variante_id,
        mov.sucursal_id,
        'ajuste',
        stockAnterior,
        movMotivo,
        'importacion',
        importacionLogId,
        userId,
      ]);
      return;
    }

    await queryRunner.query(REGISTRAR_MOVIMIENTO_SQL, [
      tenantId,
      mov.producto_id,
      mov.sucursal_id,
      'ajuste',
      stockAnterior,
      movMotivo,
      'importacion',
      importacionLogId,
      userId,
    ]);
  }

  private async desactivarProductoCreado(
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
    tenantId: string,
    productoId: string,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE public.producto_variante_stock_sucursal SET stock_actual = 0
       WHERE tenant_id = $1 AND producto_id = $2`,
      [tenantId, productoId],
    );
    await queryRunner.query(
      `UPDATE public.producto_variante SET activo = false
       WHERE tenant_id = $1 AND producto_id = $2`,
      [tenantId, productoId],
    );
    await queryRunner.query(
      `UPDATE public.producto SET activo = false, stock_actual = 0
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, productoId],
    );
  }

  private async restaurarProductoActualizado(
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
    tenantId: string,
    productoId: string,
    before: ReturnType<typeof asProductoImportSnapshot> & object,
  ): Promise<void> {
    const patch = productoUpdateFromSnapshot(before);
    const repo = queryRunner.manager.getRepository(Producto);
    await repo.update({ id: productoId, tenantId }, patch);
  }

  private async restaurarPreciosSucursal(
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
    tenantId: string,
    productoId: string,
    beforeRaw: unknown,
  ): Promise<{ restored: number; deleted: number }> {
    const before = asPrecioSucursalSnapshots(beforeRaw);
    const actuales = (await queryRunner.query(
      `SELECT id FROM public.precio_sucursal WHERE tenant_id = $1 AND producto_id = $2`,
      [tenantId, productoId],
    )) as Array<{ id: string }>;

    const beforeIds = new Set(before.map((row) => row.id));
    const idsAEliminar = actuales.map((r) => r.id).filter((id) => !beforeIds.has(id));

    let deleted = 0;
    if (idsAEliminar.length > 0) {
      const delResult = (await queryRunner.query(
        `DELETE FROM public.precio_sucursal
         WHERE tenant_id = $1 AND producto_id = $2 AND id = ANY($3::uuid[])
         RETURNING id`,
        [tenantId, productoId, idsAEliminar],
      )) as unknown[];
      deleted = Array.isArray(delResult) ? delResult.length : idsAEliminar.length;
    }

    let restored = 0;
    for (const precio of before) {
      await queryRunner.query(
        `INSERT INTO public.precio_sucursal (
           id, tenant_id, producto_id, sucursal_id, precio_costo, precio_venta, porcentaje_ganancia
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           precio_costo = EXCLUDED.precio_costo,
           precio_venta = EXCLUDED.precio_venta,
           porcentaje_ganancia = EXCLUDED.porcentaje_ganancia`,
        [
          precio.id,
          tenantId,
          productoId,
          precio.sucursal_id,
          precio.precio_costo,
          precio.precio_venta,
          precio.porcentaje_ganancia,
        ],
      );
      restored += 1;
    }

    return { restored, deleted };
  }
}
