import { BadRequestException } from '@nestjs/common';
import type { SelectQueryBuilder } from 'typeorm';

import type { Categoria } from '../catalog/entities/categoria.entity';
import type { Proveedor } from '../catalog/entities/proveedor.entity';
import type { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import type { Sucursal } from '../branches/entities/sucursal.entity';
import type { ListProductsQueryDto } from './dto/list-products-query.dto';
import type { ProductoVariante } from './entities/producto-variante.entity';
import type { Producto } from './entities/producto.entity';
import {
  IVA_DEFAULT_PCT,
  margenGananciaSobreCostoSinIva,
} from './utils/calcular-precio-venta';
import { etiquetaVariante } from './utils/variante-label';

export const MAX_SOLO_IDS = 250;
export const MAX_BULK_FILTRO = 20_000;
export const MAX_IDS_BULK_LOTE = 250;

export type ListScope = {
  tenantId: string;
  alcance: 'tenant' | 'sucursal';
  sucursalIdsFiltro: string[];
  sucursalIdRespuesta: string | null;
  depositoListadoId: string | null;
};

export function assertProveedorFiltersValid(query: ListProductsQueryDto): string[] | null {
  const proveedorIds =
    query.proveedorIds?.length
      ? query.proveedorIds
      : query.proveedorId
        ? [query.proveedorId]
        : null;

  if (proveedorIds && query.proveedorExcluirId) {
    throw new BadRequestException(
      'No pod├®s usar proveedorIds/proveedorId y proveedorExcluirId a la vez.',
    );
  }
  if (query.proveedorIds?.length && query.proveedorId) {
    throw new BadRequestException('Us├í solo proveedorId o proveedorIds, no ambos.');
  }

  return proveedorIds;
}

export function vencidosHastaDate(): string {
  const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0]!;
}

export function applyListFilters(
  qb: SelectQueryBuilder<Producto>,
  opts: {
    tenantId: string;
    scope: ListScope;
    query: ListProductsQueryDto;
    proveedorIds: string[] | null;
    productIdsByBarcode?: string[];
  },
): SelectQueryBuilder<Producto> {
  const { tenantId, scope, query, proveedorIds, productIdsByBarcode } = opts;

  qb.where('p.tenant_id = :tenantId', { tenantId });

  if (query.onlyInactive) {
    qb.andWhere('p.activo = false');
  } else if (!query.includeInactive) {
    qb.andWhere('p.activo = true');
  }

  if (scope.depositoListadoId) {
    qb.andWhere(
      `(p.sucursal_id = :depotId OR EXISTS (
        SELECT 1 FROM stock_sucursal ss_vis
        WHERE ss_vis.producto_id = p.id
          AND ss_vis.sucursal_id = :depotId
          AND ss_vis.tenant_id = :tenantId
      ))`,
      { depotId: scope.depositoListadoId, tenantId },
    );
  } else if (scope.alcance === 'tenant') {
    qb.andWhere('p.sucursal_id IN (:...sucursalIds)', {
      sucursalIds: scope.sucursalIdsFiltro,
    });
  }

  if (productIdsByBarcode?.length) {
    qb.andWhere('p.id IN (:...productIdsByBarcode)', { productIdsByBarcode });
  } else if (productIdsByBarcode) {
    qb.andWhere('1 = 0');
  }

  const q = query.q?.trim();
  if (q) {
    qb.andWhere('(p.nombre ILIKE :q OR p.codigo ILIKE :q)', { q: `%${q}%` });
  }

  if (query.categoriaId) {
    qb.andWhere('p.categoria_id = :categoriaId', { categoriaId: query.categoriaId });
  }

  if (proveedorIds?.length) {
    qb.andWhere('p.proveedor_id IN (:...proveedorIds)', { proveedorIds });
  }
  if (query.proveedorExcluirId) {
    qb.andWhere('(p.proveedor_id IS NULL OR p.proveedor_id != :proveedorExcluirId)', {
      proveedorExcluirId: query.proveedorExcluirId,
    });
  }

  if (query.vencidos) {
    qb.andWhere('p.fecha_vencimiento IS NOT NULL').andWhere('p.fecha_vencimiento <= :vencidosHasta', {
      vencidosHasta: vencidosHastaDate(),
    });
  }

  if (query.stockBajo) {
    if (scope.depositoListadoId) {
      qb.leftJoin(
        'stock_sucursal',
        'ss_bajo',
        'ss_bajo.producto_id = p.id AND ss_bajo.sucursal_id = :depotBajo AND ss_bajo.tenant_id = :tenantId',
        { depotBajo: scope.depositoListadoId, tenantId },
      );
      qb.andWhere(
        `(
          (ss_bajo.id IS NOT NULL AND ss_bajo.stock_minimo > 0 AND ss_bajo.stock_actual <= ss_bajo.stock_minimo)
          OR (ss_bajo.id IS NULL AND p.sucursal_id = :depotBajo AND p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo)
        )`,
        { depotBajo: scope.depositoListadoId },
      );
    } else {
      qb.andWhere('p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo');
    }
  }

  const ordenPorActualizado = query.orden === 'actualizado';
  if (ordenPorActualizado) {
    qb.orderBy('p.updated_at', 'DESC');
  } else {
    qb.orderBy('p.nombre', 'ASC');
  }

  return qb;
}

export type SerializedListProduct = ReturnType<typeof serializeListProductBase>;

function serializeListProductBase(p: Producto) {
  return {
    id: p.id,
    tenantId: p.tenantId,
    codigo: p.codigo,
    nombre: p.nombre,
    descripcion: p.descripcion,
    categoriaId: p.categoriaId,
    proveedorId: p.proveedorId,
    sucursalId: p.sucursalId,
    unidad: p.unidad,
    precioCosto: Number(p.precioCosto),
    precioVenta: Number(p.precioVenta),
    stockActual: Number(p.stockActual),
    stockMinimo: Number(p.stockMinimo),
    codigoBarras: p.codigoBarras,
    plu: p.plu,
    esPesable: p.esPesable,
    fechaVencimiento: p.fechaVencimiento,
    imagenUrl: p.imagenUrl,
    usaVariantes: p.usaVariantes,
    activo: p.activo,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export type StockOverlay = {
  stockActual: number;
  stockMinimo: number;
  ubicacion: string | null;
};

export function buildStockOverlayMap(
  rows: StockSucursal[],
): Map<string, StockOverlay> {
  const map = new Map<string, StockOverlay>();
  for (const row of rows) {
    map.set(row.productoId, {
      stockActual: Number(row.stockActual),
      stockMinimo: Number(row.stockMinimo),
      ubicacion: row.ubicacion,
    });
  }
  return map;
}

export function sumStockOverlayMap(
  rows: StockSucursal[],
): Map<string, StockOverlay> {
  const map = new Map<string, StockOverlay>();
  for (const row of rows) {
    const prev = map.get(row.productoId);
    if (prev) {
      prev.stockActual += Number(row.stockActual);
      prev.stockMinimo += Number(row.stockMinimo);
    } else {
      map.set(row.productoId, {
        stockActual: Number(row.stockActual),
        stockMinimo: Number(row.stockMinimo),
        ubicacion: null,
      });
    }
  }
  return map;
}

export function enrichListProducts(
  productos: Producto[],
  opts: {
    categorias: Map<string, Categoria>;
    proveedores: Map<string, Proveedor>;
    sucursales: Map<string, Sucursal>;
    stockOverlay?: Map<string, StockOverlay>;
    depositoListadoId?: string | null;
    variantesPorProducto?: Map<string, ProductoVariante[]>;
    stockPorVariante?: Map<string, number>;
  },
): Array<
  SerializedListProduct & {
    margenGananciaPct: number | null;
    ubicacion: string | null;
    categoria: { id: string; nombre: string } | null;
    proveedor: { id: string; nombre: string } | null;
    sucursal: { id: string; nombre: string; codigo: string } | null;
    variantes?: Array<{
      id: string;
      codigo: string | null;
      codigoBarras: string | null;
      atributos: Record<string, unknown>;
      etiqueta: string;
      activo: boolean;
      orden: number;
      stockActual: number;
    }>;
  }
> {
  const {
    categorias,
    proveedores,
    sucursales,
    stockOverlay,
    depositoListadoId,
    variantesPorProducto,
    stockPorVariante,
  } = opts;

  return productos.map((p) => {
    const base = serializeListProductBase(p);
    const overlay = stockOverlay?.get(p.id);
    let stockActual = base.stockActual;
    let stockMinimo = base.stockMinimo;
    let ubicacion: string | null = null;

    if (overlay) {
      stockActual = overlay.stockActual;
      stockMinimo = overlay.stockMinimo;
      ubicacion = overlay.ubicacion;
    } else if (depositoListadoId && p.sucursalId === depositoListadoId) {
      ubicacion = null;
    }

    const cat = p.categoriaId ? categorias.get(p.categoriaId) : undefined;
    const prov = p.proveedorId ? proveedores.get(p.proveedorId) : undefined;
    const suc = p.sucursalId ? sucursales.get(p.sucursalId) : undefined;

    const item = {
      ...base,
      stockActual,
      stockMinimo,
      ubicacion,
      margenGananciaPct: margenGananciaSobreCostoSinIva(
        base.precioCosto,
        base.precioVenta,
        null,
        IVA_DEFAULT_PCT,
      ),
      categoria: cat ? { id: cat.id, nombre: cat.nombre } : null,
      proveedor: prov ? { id: prov.id, nombre: prov.nombre } : null,
      sucursal: suc ? { id: suc.id, nombre: suc.nombre, codigo: suc.codigo } : null,
    };

    if (variantesPorProducto && p.usaVariantes) {
      const vars = variantesPorProducto.get(p.id) ?? [];
      return {
        ...item,
        variantes: vars.map((v) => ({
          id: v.id,
          codigo: v.codigo,
          codigoBarras: v.codigoBarras,
          atributos: v.atributos,
          etiqueta: etiquetaVariante(v.atributos, v.etiqueta),
          activo: v.activo,
          orden: v.orden,
          stockActual: stockPorVariante?.get(v.id) ?? 0,
        })),
      };
    }

    return item;
  });
}
