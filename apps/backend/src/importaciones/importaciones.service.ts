import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, In, QueryRunner, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';
import { REGISTRAR_MOVIMIENTO_SQL } from '../inventory/sql/registrar-movimiento.sql';
import {
  inferBarcodeTipoByLength,
  isValidBarcodeByTipo,
  isValidEan13,
  isValidUpca,
} from '../products/barcodes/barcode-validation.util';
import { ProductoBarcode } from '../products/entities/producto-barcode.entity';
import { Producto } from '../products/entities/producto.entity';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import { ExecuteImportRequestDto } from './dto/execute-import-request.dto';
import { ImportPreviewRequestDto } from './dto/import-preview-request.dto';
import { ImportPreviewRowDto } from './dto/import-preview-row.dto';
import { ImportDraftService } from './import-draft.service';
import {
  snapshotPreciosSucursal,
  snapshotProductoImport,
} from './utils/import-product-snapshot.util';

type ImportTraceContext = {
  importLogId: string;
  fila: number;
};

type ErrorFila = {
  campo: string;
  mensaje: string;
  valorOriginal: unknown;
};

type FilaPreview = {
  fila: number;
  accion: 'crear' | 'actualizar' | 'rechazar';
  productoId: string | null;
  codigo: string | null;
  nombre: string | null;
  barcode: string | null;
  errores: ErrorFila[];
};

@Injectable()
export class ImportacionesService {
  constructor(
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(ProductoBarcode)
    private readonly productoBarcodeRepo: Repository<ProductoBarcode>,
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContext,
    private readonly branchStockService: BranchStockService,
    private readonly importDraftService: ImportDraftService,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async previewImport(dto: ImportPreviewRequestDto) {
    const tenantId = this.tenantContext.getTenantId();
    const normalizedRows = dto.filas.map((row, idx) => this.normalizeRow(row, idx + 1));

    const codigos = normalizedRows
      .map((row) => row.codigo)
      .filter((value): value is string => Boolean(value));
    const barcodes = normalizedRows
      .map((row) => row.barcode)
      .filter((value): value is string => Boolean(value));

    const [productosByCodigo, productosByLegacyBarcode, productosByBarcodeTable] = await Promise.all([
      codigos.length > 0
        ? this.productoRepo.find({
            where: { tenantId, activo: true, codigo: In(codigos) },
            select: { id: true, codigo: true, nombre: true, codigoBarras: true },
          })
        : Promise.resolve([]),
      barcodes.length > 0
        ? this.productoRepo.find({
            where: { tenantId, activo: true, codigoBarras: In(barcodes) },
            select: { id: true, codigo: true, nombre: true, codigoBarras: true },
          })
        : Promise.resolve([]),
      barcodes.length > 0
        ? this.productoBarcodeRepo.find({
            where: { tenantId, activo: true, valor: In(barcodes) },
            select: { id: true, productoId: true, valor: true },
          })
        : Promise.resolve([]),
    ]);

    const byCodigo = new Map(productosByCodigo.map((p) => [p.codigo.toLowerCase(), p.id]));
    const byLegacyBarcode = new Map(
      productosByLegacyBarcode
        .filter((p) => p.codigoBarras)
        .map((p) => [String(p.codigoBarras).trim(), p.id]),
    );
    const byBarcodeTable = new Map(productosByBarcodeTable.map((b) => [b.valor, b.productoId]));

    const codigoCount = this.countOccurrences(codigos.map((v) => v.toLowerCase()));
    const barcodeCount = this.countOccurrences(barcodes);

    const filas = normalizedRows.map((row): FilaPreview => {
      const errores: ErrorFila[] = [];

      if (!row.nombre) {
        errores.push({ campo: 'nombre', mensaje: 'Nombre requerido', valorOriginal: row.source.nombre });
      }

      if (row.codigo && (codigoCount.get(row.codigo.toLowerCase()) ?? 0) > 1) {
        errores.push({
          campo: 'codigo',
          mensaje: 'C├│digo duplicado dentro del archivo',
          valorOriginal: row.source.codigo,
        });
      }

      if (row.barcode && (barcodeCount.get(row.barcode) ?? 0) > 1) {
        errores.push({
          campo: 'barcode',
          mensaje: 'Barcode duplicado dentro del archivo',
          valorOriginal: row.barcode,
        });
      }

      if (row.fechaVencimiento && Number.isNaN(Date.parse(`${row.fechaVencimiento}T00:00:00.000Z`))) {
        errores.push({
          campo: 'fechaVencimiento',
          mensaje: 'Fecha inv├ílida (usar YYYY-MM-DD)',
          valorOriginal: row.source.fechaVencimiento,
        });
      }

      if (row.ean && !isValidEan13(row.ean)) {
        errores.push({ campo: 'ean', mensaje: 'EAN inv├ílido (checksum)', valorOriginal: row.source.ean });
      }
      if (row.upc && !isValidUpca(row.upc)) {
        errores.push({ campo: 'upc', mensaje: 'UPC inv├ílido (checksum)', valorOriginal: row.source.upc });
      }
      if (row.barcode && (row.barcodeSource === 'codigoBarras' || row.barcodeSource === 'barras')) {
        const tipo = inferBarcodeTipoByLength(row.barcode);
        if (!isValidBarcodeByTipo(tipo, row.barcode)) {
          errores.push({
            campo: row.barcodeSource,
            mensaje: 'Barcode inv├ílido (longitud/tipo/checksum)',
            valorOriginal: row.barcode,
          });
        }
      }

      const productIdByCodigo = row.codigo ? byCodigo.get(row.codigo.toLowerCase()) ?? null : null;
      const productIdByBarcode = row.barcode
        ? byBarcodeTable.get(row.barcode) ?? byLegacyBarcode.get(row.barcode) ?? null
        : null;

      if (productIdByCodigo && productIdByBarcode && productIdByCodigo !== productIdByBarcode) {
        errores.push({
          campo: 'general',
          mensaje: 'C├│digo y barcode resuelven a productos distintos',
          valorOriginal: { codigo: row.codigo, barcode: row.barcode },
        });
      }

      const productoId = productIdByCodigo ?? productIdByBarcode ?? null;
      const accion = errores.length > 0 ? 'rechazar' : productoId ? 'actualizar' : 'crear';

      return {
        fila: row.fila,
        accion,
        productoId,
        codigo: row.codigo,
        nombre: row.nombre,
        barcode: row.barcode,
        errores,
      };
    });

    const filasConError = filas.filter((f) => f.errores.length > 0).length;
    const filasValidas = filas.length - filasConError;
    const crearia = filas.filter((f) => f.accion === 'crear').length;
    const actualizaria = filas.filter((f) => f.accion === 'actualizar').length;

    return {
      data: {
        resumen: {
          totalFilas: filas.length,
          filasValidas,
          filasConError,
          crearia,
          actualizaria,
        },
        filas,
      },
    };
  }

  async executeImport(
    dto: ExecuteImportRequestDto,
    idempotencyKey: string,
    user: AccessTokenPayload,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key requerido');
    }
    const filas = await this.resolveExecuteFilas(dto, user);
    if (filas.length === 0) {
      return {
        data: {
          totalFilas: 0,
          productosCreados: 0,
          productosActualizados: 0,
          filasConError: 0,
          detalleErrores: [],
        },
      };
    }

    const normalizedKey = idempotencyKey.trim();
    const payloadHash = this.hashPayload({ ...dto, filas });
    const endpoint = 'POST:/importaciones/ejecutar';
    const userId = user.sub;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingRows = await queryRunner.query(
        `SELECT id, request_hash, status, response_json
         FROM public.idempotency_request
         WHERE tenant_id = $1 AND endpoint = $2 AND idempotency_key = $3
         FOR UPDATE`,
        [tenantId, endpoint, normalizedKey],
      );

      if (existingRows.length > 0) {
        const existing = existingRows[0] as {
          request_hash: string;
          status: string;
          response_json: unknown;
        };
        if (existing.request_hash !== payloadHash) {
          throw new ConflictException('Idempotency-Key reutilizada con payload distinto');
        }
        if (existing.status === 'completed' && existing.response_json) {
          await queryRunner.commitTransaction();
          return this.parseStoredResponse(existing.response_json);
        }
        throw new ConflictException('Importaci├│n en procesamiento para esta Idempotency-Key');
      }

      await queryRunner.query(
        `INSERT INTO public.idempotency_request
          (tenant_id, endpoint, idempotency_key, request_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'processing', now(), now())`,
        [tenantId, endpoint, normalizedKey, payloadHash],
      );

      const sucursalId = await this.sucursalContext.resolveSucursalId();
      const importLogId = await this.createImportLogPlaceholder(queryRunner, {
        tenantId,
        proveedorId: dto.proveedorId ?? null,
        archivoNombre: dto.archivoNombre ?? 'importacion-backend',
        origen: dto.origen ?? 'importacion_excel',
        sucursalId,
        cargaId: dto.cargaId ?? null,
        archivoMime: dto.archivoMime ?? null,
        archivoTamano: dto.archivoTamano ?? null,
        totalFilas: filas.length,
        usuarioId: userId,
      });

      const preview = await this.previewImport({
        filas,
        proveedorId: dto.proveedorId,
        archivoNombre: dto.archivoNombre,
        origen: dto.origen,
      });
      const normalizedRows = filas.map((row, idx) => this.normalizeRow(row, idx + 1));
      const previewByFila = new Map(preview.data.filas.map((row) => [row.fila, row]));

      let productosCreados = 0;
      let productosActualizados = 0;
      let filasConError = 0;
      const detalleErrores: Array<{
        fila: number;
        campo: string;
        valor_original: unknown;
        error: string;
      }> = [];

      for (const row of normalizedRows) {
        const previewRow = previewByFila.get(row.fila);
        if (!previewRow || previewRow.accion === 'rechazar') {
          filasConError += 1;
          const errores = previewRow?.errores ?? [
            { campo: 'general', mensaje: 'Fila rechazada en preview', valorOriginal: row.source },
          ];
          for (const err of errores) {
            detalleErrores.push({
              fila: row.fila,
              campo: err.campo,
              valor_original: err.valorOriginal,
              error: err.mensaje,
            });
          }
          continue;
        }

        const trace: ImportTraceContext = { importLogId, fila: row.fila };
        try {
          if (previewRow.productoId) {
            await this.applyUpdateRow(
              queryRunner,
              previewRow.productoId,
              row,
              dto.proveedorId,
              userId,
              trace,
            );
            productosActualizados += 1;
          } else {
            await this.applyCreateRow(queryRunner, row, dto.proveedorId, userId, trace);
            productosCreados += 1;
          }
        } catch (error) {
          filasConError += 1;
          detalleErrores.push({
            fila: row.fila,
            campo: 'general',
            valor_original: row.source,
            error: error instanceof Error ? error.message : 'Error desconocido',
          });
        }
      }

      await this.finalizeImportLog(queryRunner, importLogId, {
        totalFilas: filas.length,
        filasExitosas: productosCreados + productosActualizados,
        filasConError,
        productosCreados,
        productosActualizados,
        detalleErrores,
      });

      const response = {
        data: {
          totalFilas: filas.length,
          productosCreados,
          productosActualizados,
          filasConError,
          detalleErrores,
          idempotencyKey: normalizedKey,
        },
      };

      await queryRunner.query(
        `UPDATE public.idempotency_request
         SET status = 'completed',
             response_json = $4::jsonb,
             updated_at = now()
         WHERE tenant_id = $1 AND endpoint = $2 AND idempotency_key = $3`,
        [tenantId, endpoint, normalizedKey, JSON.stringify(response)],
      );

      await queryRunner.commitTransaction();
      return response;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private normalizeRow(row: ImportPreviewRowDto, fila: number) {
    const codigo = row.codigo?.trim() || null;
    const nombre = row.nombre?.trim() || null;
    const codigoBarras = row.codigoBarras?.trim() || null;
    const ean = row.ean?.trim() || null;
    const upc = row.upc?.trim() || null;
    const barras = row.barras?.trim() || null;
    const barcodeSource = codigoBarras
      ? 'codigoBarras'
      : ean
        ? 'ean'
        : upc
          ? 'upc'
          : barras
            ? 'barras'
            : null;
    const barcode = codigoBarras ?? ean ?? upc ?? barras ?? null;
    const fechaVencimiento = row.fechaVencimiento?.trim() || null;

    return {
      fila,
      source: row,
      codigo,
      nombre,
      codigoBarras,
      ean,
      upc,
      barras,
      barcodeSource,
      barcode,
      fechaVencimiento,
    };
  }

  private countOccurrences(values: string[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const value of values) {
      map.set(value, (map.get(value) ?? 0) + 1);
    }
    return map;
  }

  private async applyUpdateRow(
    queryRunner: QueryRunner,
    productoId: string,
    row: ReturnType<ImportacionesService['normalizeRow']>,
    requestProveedorId: string | null | undefined,
    userId: string,
    trace?: ImportTraceContext,
  ): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const repo = queryRunner.manager.getRepository(Producto);
    const existing = await repo.findOne({ where: { id: productoId, tenantId } });
    if (!existing) {
      throw new Error('Producto a actualizar no encontrado');
    }

    const productoBefore = snapshotProductoImport(existing);
    const precioRepo = queryRunner.manager.getRepository(PrecioSucursal);
    const preciosBefore = snapshotPreciosSucursal(
      await precioRepo.find({ where: { tenantId, productoId } }),
    );

    const previousPrecioCosto = Number(existing.precioCosto);
    const previousPrecioVenta = Number(existing.precioVenta);
    const previousStockActual = Number(existing.stockActual);
    const nextPrecioCosto = row.source.precioCosto ?? previousPrecioCosto;
    const nextPrecioVenta = row.source.precioVenta ?? previousPrecioVenta;
    const nextStockActual = row.source.stockActual ?? previousStockActual;

    if (row.nombre) existing.nombre = row.nombre;
    if (row.codigo) existing.codigo = row.codigo;
    if (row.source.unidad) existing.unidad = row.source.unidad;
    if (row.source.precioCosto !== undefined && row.source.precioCosto !== null) {
      existing.precioCosto = row.source.precioCosto.toFixed(2);
    }
    if (row.source.precioVenta !== undefined && row.source.precioVenta !== null) {
      existing.precioVenta = row.source.precioVenta.toFixed(2);
    }
    if (row.source.stockMinimo !== undefined && row.source.stockMinimo !== null) {
      existing.stockMinimo = row.source.stockMinimo.toFixed(3);
    }
    if (row.fechaVencimiento !== null) {
      existing.fechaVencimiento = row.fechaVencimiento;
    }
    if (requestProveedorId ?? row.source.proveedorId) {
      existing.proveedorId = (requestProveedorId ?? row.source.proveedorId)!;
    }
    if (row.barcode) {
      existing.codigoBarras = row.barcode;
    }

    await repo.save(existing);

    if (previousPrecioCosto !== nextPrecioCosto || previousPrecioVenta !== nextPrecioVenta) {
      await this.insertPrecioHistorial(queryRunner, {
        tenantId,
        productoId: existing.id,
        costoAnterior: previousPrecioCosto,
        costoNuevo: nextPrecioCosto,
        ventaAnterior: previousPrecioVenta,
        ventaNuevo: nextPrecioVenta,
        origen: 'importacion_excel',
      });
    }

    let movimientoId: string | null = null;
    if (row.source.stockActual !== undefined && row.source.stockActual !== null) {
      if (previousStockActual !== nextStockActual) {
        const sucursalId = await this.branchStockService.resolveDepotId(existing.id);
        const movRows = (await queryRunner.query(REGISTRAR_MOVIMIENTO_SQL, [
          tenantId,
          existing.id,
          sucursalId,
          'ajuste',
          nextStockActual,
          'Ajuste por importaci├│n',
          'importacion',
          trace?.importLogId ?? null,
          userId,
        ])) as Array<Record<string, unknown>>;
        movimientoId = (movRows[0]?.id as string) ?? null;
      }
    }

    if (trace) {
      const refreshed = await repo.findOne({ where: { id: productoId, tenantId } });
      if (refreshed) {
        const preciosAfter = snapshotPreciosSucursal(
          await precioRepo.find({ where: { tenantId, productoId } }),
        );
        await this.insertImportSnapshot(queryRunner, {
          tenantId,
          importLogId: trace.importLogId,
          productoId,
          accion: 'updated',
          filaOriginal: trace.fila,
          productoBefore,
          productoAfter: snapshotProductoImport(refreshed),
          precioSucursalBefore: preciosBefore,
          precioSucursalAfter: preciosAfter,
          movimientoId,
        });
      }
    }
  }

  private async applyCreateRow(
    queryRunner: QueryRunner,
    row: ReturnType<ImportacionesService['normalizeRow']>,
    requestProveedorId: string | null | undefined,
    userId: string,
    trace?: ImportTraceContext,
  ): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.branchStockService.resolveDepotId();
    const repo = queryRunner.manager.getRepository(Producto);
    const codigo = row.codigo ?? `IMP-${Date.now()}-${row.fila}`;
    const stockActual = row.source.stockActual ?? 0;
    const newProduct = repo.create({
      tenantId,
      codigo,
      nombre: row.nombre ?? `Producto importado ${row.fila}`,
      descripcion: null,
      categoriaId: null,
      proveedorId: requestProveedorId ?? row.source.proveedorId ?? null,
      sucursalId,
      unidad: row.source.unidad ?? UnidadMedida.unidad,
      precioCosto: (row.source.precioCosto ?? 0).toFixed(2),
      precioVenta: (row.source.precioVenta ?? 0).toFixed(2),
      stockActual: '0.000',
      stockMinimo: (row.source.stockMinimo ?? 0).toFixed(3),
      codigoBarras: row.barcode,
      plu: null,
      esPesable: false,
      fechaVencimiento: row.fechaVencimiento,
      imagenUrl: null,
      activo: true,
    });

    const saved = await repo.save(newProduct);
    let movimientoId: string | null = null;
    if (stockActual > 0) {
      const movRows = (await queryRunner.query(REGISTRAR_MOVIMIENTO_SQL, [
        tenantId,
        saved.id,
        sucursalId,
        'entrada',
        stockActual,
        'Stock inicial por importaci├│n',
        'importacion',
        trace?.importLogId ?? null,
        userId,
      ])) as Array<Record<string, unknown>>;
      movimientoId = (movRows[0]?.id as string) ?? null;
    }

    if (trace) {
      const refreshed = await repo.findOne({ where: { id: saved.id, tenantId } });
      if (refreshed) {
        await this.insertImportSnapshot(queryRunner, {
          tenantId,
          importLogId: trace.importLogId,
          productoId: saved.id,
          accion: 'created',
          filaOriginal: trace.fila,
          productoBefore: null,
          productoAfter: snapshotProductoImport(refreshed),
          precioSucursalBefore: [],
          precioSucursalAfter: [],
          movimientoId,
        });
      }
    }
  }

  private async insertPrecioHistorial(
    queryRunner: QueryRunner,
    params: {
      tenantId: string;
      productoId: string;
      costoAnterior: number;
      costoNuevo: number;
      ventaAnterior: number;
      ventaNuevo: number;
      origen: string;
    },
  ): Promise<void> {
    const margenAnterior = this.calculateMargin(params.costoAnterior, params.ventaAnterior);
    const margenNuevo = this.calculateMargin(params.costoNuevo, params.ventaNuevo);
    await queryRunner.query(
      `INSERT INTO public.precio_historial (
         tenant_id,
         producto_id,
         precio_costo_anterior,
         precio_costo_nuevo,
         precio_venta_anterior,
         precio_venta_nuevo,
         margen_anterior,
         margen_nuevo,
         origen
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::origen_precio)`,
      [
        params.tenantId,
        params.productoId,
        params.costoAnterior,
        params.costoNuevo,
        params.ventaAnterior,
        params.ventaNuevo,
        margenAnterior,
        margenNuevo,
        params.origen,
      ],
    );
  }

  private async createImportLogPlaceholder(
    queryRunner: QueryRunner,
    params: {
      tenantId: string;
      proveedorId: string | null;
      archivoNombre: string;
      origen: string;
      sucursalId: string | null;
      cargaId: string | null;
      archivoMime: string | null;
      archivoTamano: number | null;
      totalFilas: number;
      usuarioId: string;
    },
  ): Promise<string> {
    const rows = (await queryRunner.query(
      `INSERT INTO public.importacion_log (
         tenant_id, proveedor_id, archivo_nombre, origen, sucursal_id, carga_id,
         archivo_mime, archivo_tamano, estado, total_filas, filas_exitosas, filas_con_error,
         productos_creados, productos_actualizados, usuario_id
       ) VALUES ($1,$2,$3,$4::origen_precio,$5,$6,$7,$8,'aplicada',$9,0,0,0,0,$10)
       RETURNING id`,
      [
        params.tenantId,
        params.proveedorId,
        params.archivoNombre,
        params.origen,
        params.sucursalId,
        params.cargaId,
        params.archivoMime,
        params.archivoTamano,
        params.totalFilas,
        params.usuarioId,
      ],
    )) as Array<{ id: string }>;
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('No se pudo crear importacion_log');
    }
    return id;
  }

  private async finalizeImportLog(
    queryRunner: QueryRunner,
    importLogId: string,
    params: {
      totalFilas: number;
      filasExitosas: number;
      filasConError: number;
      productosCreados: number;
      productosActualizados: number;
      detalleErrores: Array<{ fila: number; campo: string; valor_original: unknown; error: string }>;
    },
  ): Promise<void> {
    const detalleErroresJson =
      params.detalleErrores.length > 0 ? JSON.stringify(params.detalleErrores) : null;
    await queryRunner.query(
      `UPDATE public.importacion_log
       SET total_filas = $2,
           filas_exitosas = $3,
           filas_con_error = $4,
           productos_creados = $5,
           productos_actualizados = $6,
           detalle_errores = $7::jsonb
       WHERE id = $1`,
      [
        importLogId,
        params.totalFilas,
        params.filasExitosas,
        params.filasConError,
        params.productosCreados,
        params.productosActualizados,
        detalleErroresJson,
      ],
    );
  }

  private async insertImportSnapshot(
    queryRunner: QueryRunner,
    params: {
      tenantId: string;
      importLogId: string;
      productoId: string;
      accion: 'created' | 'updated';
      filaOriginal: number;
      productoBefore: Record<string, unknown> | null;
      productoAfter: Record<string, unknown>;
      precioSucursalBefore: unknown;
      precioSucursalAfter: unknown;
      movimientoId: string | null;
    },
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO public.importacion_producto_snapshot (
         tenant_id, importacion_log_id, producto_id, accion, fila_original,
         producto_before, producto_after, precio_sucursal_before, precio_sucursal_after, movimiento_id
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
      [
        params.tenantId,
        params.importLogId,
        params.productoId,
        params.accion,
        params.filaOriginal,
        params.productoBefore ? JSON.stringify(params.productoBefore) : null,
        JSON.stringify(params.productoAfter),
        JSON.stringify(params.precioSucursalBefore ?? []),
        JSON.stringify(params.precioSucursalAfter ?? []),
        params.movimientoId,
      ],
    );
  }

  private calculateMargin(costo: number, venta: number): number {
    if (costo <= 0) return 0;
    return Number((((venta - costo) / costo) * 100).toFixed(6));
  }

  private async resolveExecuteFilas(
    dto: ExecuteImportRequestDto,
    user: AccessTokenPayload,
  ): Promise<ImportPreviewRowDto[]> {
    if (dto.draftId?.trim()) {
      return this.importDraftService.resolveExecuteRows(
        dto.draftId.trim(),
        user,
        dto.draftChunkStart ?? 0,
        dto.draftChunksToProcess ?? 1,
      );
    }
    const filas = dto.filas ?? [];
    if (filas.length === 0) {
      throw new BadRequestException('No hay filas para importar');
    }
    return filas;
  }

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private parseStoredResponse(value: unknown): unknown {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
}
