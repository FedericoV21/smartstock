import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { BranchPricingService } from '../branches/branch-pricing.service';
import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ProductoVarianteStockSucursal } from '../products/entities/producto-variante-stock-sucursal.entity';
import { ProductoVariante } from '../products/entities/producto-variante.entity';
import { Producto } from '../products/entities/producto.entity';
import { dedupeProductosCatalogoParaCaja, type StockOverlayPos } from './utils/pos-dedupe.util';
import {
  attachVariantesList,
  etiquetaVariantePos,
  serializePosProducto,
  type PosProductoPayload,
} from './utils/pos-serialize.util';

@Injectable()
export class PosEnrichmentService {
  constructor(
    @InjectRepository(StockSucursal)
    private readonly stockRepo: Repository<StockSucursal>,
    @InjectRepository(PrecioSucursal)
    private readonly precioRepo: Repository<PrecioSucursal>,
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(ProductoVariante)
    private readonly varianteRepo: Repository<ProductoVariante>,
    @InjectRepository(ProductoVarianteStockSucursal)
    private readonly varianteStockRepo: Repository<ProductoVarianteStockSucursal>,
    private readonly branchPricingService: BranchPricingService,
  ) {}

  async loadStockMap(
    tenantId: string,
    sucursalId: string,
    productoIds: string[],
  ): Promise<Map<string, StockOverlayPos>> {
    if (productoIds.length === 0) return new Map();
    const rows = await this.stockRepo.find({
      where: { tenantId, sucursalId, productoId: In(productoIds) },
    });
    const map = new Map<string, StockOverlayPos>();
    for (const r of rows) {
      map.set(r.productoId, {
        stock_actual: Number(r.stockActual),
        stock_minimo: Number(r.stockMinimo),
        ubicacion: r.ubicacion,
      });
    }
    return map;
  }

  async loadPrecioOverrides(
    tenantId: string,
    sucursalId: string,
    productoIds: string[],
  ): Promise<Map<string, PrecioSucursal>> {
    if (productoIds.length === 0) return new Map();
    const rows = await this.precioRepo.find({
      where: { tenantId, sucursalId, productoId: In(productoIds) },
    });
    return new Map(rows.map((r) => [r.productoId, r]));
  }

  async enrichProductos(
    tenantId: string,
    sucursalId: string,
    productos: Producto[],
    stockMapPrecargado?: Map<string, StockOverlayPos>,
  ): Promise<PosProductoPayload[]> {
    if (productos.length === 0) return [];

    const ids = productos.map((p) => p.id);
    const [stockMap, precioMap, categorias, proveedores] = await Promise.all([
      stockMapPrecargado ?? this.loadStockMap(tenantId, sucursalId, ids),
      this.loadPrecioOverrides(tenantId, sucursalId, ids),
      this.loadCategorias(tenantId, productos),
      this.loadProveedores(tenantId, productos),
    ]);

    const deduped = dedupeProductosCatalogoParaCaja(productos, sucursalId, stockMap);

    return deduped.map((p) => {
      const st = stockMap.get(p.id);
      const ov = precioMap.get(p.id);
      const eff = this.branchPricingService.mergeEffective(p, ov ?? null, sucursalId);
      const cat = p.categoriaId ? categorias.get(p.categoriaId) : undefined;
      const prov = p.proveedorId ? proveedores.get(p.proveedorId) : undefined;
      return serializePosProducto(p, {
        precioCosto: eff.precioCosto,
        precioVenta: eff.precioVenta,
        porcentajeGanancia: eff.porcentajeGanancia,
        stockActual: st?.stock_actual ?? Number(p.stockActual),
        stockMinimo: st?.stock_minimo ?? Number(p.stockMinimo),
        categoria: cat ?? null,
        proveedor: prov ?? null,
      });
    });
  }

  async attachVariantes(
    tenantId: string,
    sucursalId: string,
    productos: PosProductoPayload[],
  ): Promise<PosProductoPayload[]> {
    const idsConVariantes = productos.filter((p) => p.usa_variantes).map((p) => p.id);
    if (idsConVariantes.length === 0) return productos;

    const variantes = await this.varianteRepo.find({
      where: { tenantId, activo: true, productoId: In(idsConVariantes) },
      order: { orden: 'ASC' },
    });
    const varianteIds = variantes.map((v) => v.id);
    const stocks =
      varianteIds.length > 0
        ? await this.varianteStockRepo.find({
            where: { tenantId, sucursalId, varianteId: In(varianteIds) },
          })
        : [];
    const stockPorVar = new Map(
      stocks.map((s) => [
        s.varianteId,
        {
          stock_actual: Number(s.stockActual),
          stock_minimo: Number(s.stockMinimo),
          ubicacion: s.ubicacion,
        },
      ]),
    );
    const porProducto = new Map<string, ProductoVariante[]>();
    for (const v of variantes) {
      const arr = porProducto.get(v.productoId) ?? [];
      arr.push(v);
      porProducto.set(v.productoId, arr);
    }

    return productos.map((p) =>
      attachVariantesList(p, porProducto.get(p.id) ?? [], stockPorVar),
    );
  }

  async expandCatalogoConVariantes(
    tenantId: string,
    sucursalId: string,
    items: PosProductoPayload[],
  ): Promise<PosProductoPayload[]> {
    const conVariantes = await this.attachVariantes(tenantId, sucursalId, items);
    const expanded: PosProductoPayload[] = [];
    for (const base of conVariantes) {
      if (!base.usa_variantes || !base.variantes?.length) {
        expanded.push(base);
        continue;
      }
      for (const v of base.variantes) {
        const etiqueta = v.etiqueta;
        expanded.push({
          ...base,
          producto_variante_id: v.id,
          codigo: v.codigo || base.codigo,
          codigo_barras: v.codigo_barras ?? base.codigo_barras,
          nombre: `${base.nombre} - ${etiqueta}`,
          stock_actual: v.stock_actual,
          stock_minimo: v.stock_minimo,
          variante: {
            id: v.id,
            codigo: v.codigo,
            codigo_barras: v.codigo_barras,
            atributos: v.atributos,
            etiqueta,
          },
        });
      }
    }
    return expanded;
  }

  async loadVarianteStockMap(
    tenantId: string,
    sucursalId: string,
    varianteIds: string[],
  ): Promise<Map<string, { stock_actual: number; stock_minimo: number }>> {
    if (varianteIds.length === 0) return new Map();
    const rows = await this.varianteStockRepo.find({
      where: { tenantId, sucursalId, varianteId: In(varianteIds) },
    });
    return new Map(
      rows.map((r) => [
        r.varianteId,
        { stock_actual: Number(r.stockActual), stock_minimo: Number(r.stockMinimo) },
      ]),
    );
  }

  async resolveVariantesByIds(
    tenantId: string,
    varianteIds: string[],
  ): Promise<
    Map<
      string,
      {
        id: string;
        productoId: string;
        codigo: string | null;
        codigoBarras: string | null;
        atributos: Record<string, unknown>;
        etiqueta: string;
      }
    >
  > {
    if (varianteIds.length === 0) return new Map();
    const rows = await this.varianteRepo.find({
      where: { tenantId, activo: true, id: In(varianteIds) },
    });
    return new Map(
      rows.map((v) => [
        v.id,
        {
          id: v.id,
          productoId: v.productoId,
          codigo: v.codigo,
          codigoBarras: v.codigoBarras,
          atributos: v.atributos,
          etiqueta: etiquetaVariantePos(v.atributos, v.etiqueta),
        },
      ]),
    );
  }

  private async loadCategorias(tenantId: string, productos: Producto[]) {
    const ids = [...new Set(productos.map((p) => p.categoriaId).filter(Boolean))] as string[];
    if (ids.length === 0) return new Map<string, Categoria>();
    const rows = await this.categoriaRepo.find({ where: { tenantId, id: In(ids) } });
    return new Map(rows.map((c) => [c.id, c]));
  }

  private async loadProveedores(tenantId: string, productos: Producto[]) {
    const ids = [...new Set(productos.map((p) => p.proveedorId).filter(Boolean))] as string[];
    if (ids.length === 0) return new Map<string, Proveedor>();
    const rows = await this.proveedorRepo.find({ where: { tenantId, id: In(ids) } });
    return new Map(rows.map((p) => [p.id, p]));
  }
}
