import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, QueryFailedError, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { BranchStockService } from '../branches/branch-stock.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Tenant } from '../config/entities/tenant.entity';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { UsersService } from '../users/users.service';
import { BulkByFilterDto } from './dto/bulk-by-filter.dto';
import { BulkMarginDto } from './dto/bulk-margin.dto';
import { CreateProductoBarcodeDto } from './dto/create-producto-barcode.dto';
import { CreateProductoDto } from './dto/create-producto.dto';
import { GetProductoQueryDto } from './dto/get-producto-query.dto';
import { ListProductoBarcodesQueryDto } from './dto/list-producto-barcodes-query.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductoBarcodeDto } from './dto/update-producto-barcode.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { inferBarcodeTipoByLength, isValidBarcodeByTipo } from './barcodes/barcode-validation.util';
import {
  generarEAN13Interno,
  siguienteSecuencialInterno,
} from './barcodes/ean13-interno.util';
import { ProductoBarcode } from './entities/producto-barcode.entity';
import { ProductoVarianteStockSucursal } from './entities/producto-variante-stock-sucursal.entity';
import { ProductoVariante } from './entities/producto-variante.entity';
import { Producto } from './entities/producto.entity';
import { ProductoBarcodeTipo } from './enums/producto-barcode-tipo.enum';
import {
  MAX_BULK_FILTRO,
  MAX_IDS_BULK_LOTE,
  MAX_SOLO_IDS,
  applyListFilters,
  assertProveedorFiltersValid,
  buildStockOverlayMap,
  enrichListProducts,
  sumStockOverlayMap,
  type ListScope,
} from './products-list.helpers';
import {
  calcularPrecioVenta,
  IVA_DEFAULT_PCT,
} from './utils/calcular-precio-venta';
import { effectivePosPricingPrefs } from './utils/effective-pos-prefs.util';
import { parseGananciaPct } from './utils/parse-ganancia-pct.util';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(ProductoBarcode)
    private readonly productoBarcodeRepo: Repository<ProductoBarcode>,
    @InjectRepository(StockSucursal)
    private readonly stockSucursalRepo: Repository<StockSucursal>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ProductoVariante)
    private readonly varianteRepo: Repository<ProductoVariante>,
    @InjectRepository(ProductoVarianteStockSucursal)
    private readonly varianteStockRepo: Repository<ProductoVarianteStockSucursal>,
    private readonly tenantContext: TenantContext,
    private readonly branchStockService: BranchStockService,
    private readonly sucursalContext: SucursalContext,
    private readonly usersService: UsersService,
  ) {}

  async list(query: ListProductsQueryDto, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const proveedorIds = assertProveedorFiltersValid(query);
    const scope = await this.resolveListScope(query, user, tenantId);

    const includeInactive = query.includeInactive ?? false;
    const barcode = query.barcode?.trim();
    let productIdsByBarcode: string[] | undefined;
    if (barcode) {
      const matchingIds = await this.resolveProductIdsByBarcode(
        tenantId,
        barcode,
        includeInactive || !!query.onlyInactive,
      );
      if (matchingIds.length === 0) {
        return this.emptyListResponse(scope, page, pageSize, query.soloIds);
      }
      productIdsByBarcode = matchingIds;
    }

    const qb = applyListFilters(this.productoRepo.createQueryBuilder('p'), {
      tenantId,
      scope,
      query,
      proveedorIds,
      productIdsByBarcode,
    });

    if (query.soloIds) {
      const rows = await qb.select(['p.id', 'p.stockActual', 'p.stockMinimo', 'p.sucursalId']).getMany();
      const enriched = await this.enrichRows(rows, scope, tenantId, query.incluirVariantes ?? false);
      let ids = enriched.map((r) => r.id);
      if (query.stockBajo) {
        ids = enriched
          .filter((p) => p.stockMinimo > 0 && p.stockActual <= p.stockMinimo)
          .map((p) => p.id);
      }
      const total = ids.length;
      const truncated = total > MAX_SOLO_IDS;
      return {
        data: { ids: ids.slice(0, MAX_SOLO_IDS) },
        meta: {
          total,
          truncated,
          sucursalId: scope.sucursalIdRespuesta,
          listadoStockDepositoId: scope.depositoListadoId,
          alcance: scope.alcance,
        },
      };
    }

    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    const data = await this.enrichRows(rows, scope, tenantId, query.incluirVariantes ?? false);

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
        sucursalId: scope.sucursalIdRespuesta,
        listadoStockDepositoId: scope.depositoListadoId,
        alcance: scope.alcance,
      },
    };
  }

  private emptyListResponse(
    scope: ListScope,
    page: number,
    pageSize: number,
    soloIds?: boolean,
  ) {
    const metaBase = {
      total: 0,
      sucursalId: scope.sucursalIdRespuesta,
      listadoStockDepositoId: scope.depositoListadoId,
      alcance: scope.alcance,
    };
    if (soloIds) {
      return {
        data: { ids: [] as string[] },
        meta: { ...metaBase, truncated: false },
      };
    }
    return {
      data: [],
      meta: { ...metaBase, page, pageSize, pageCount: 1 },
    };
  }

  private async resolveListScope(
    query: ListProductsQueryDto,
    user: AccessTokenPayload,
    tenantId: string,
  ): Promise<ListScope> {
    const appRole = resolveAppRole(user);
    const alcanceTenant = query.alcance === 'tenant';

    if (alcanceTenant) {
      let sucursalIdsFiltro: string[];
      if (query.contextoPedidos || query.contextoPromociones) {
        const todas = await this.sucursalRepo.find({
          where: { tenantId, activa: true },
          select: ['id'],
        });
        if (todas.length === 0) {
          throw new ForbiddenException(
            'No hay sucursales activas en el negocio para listar el cat├ílogo.',
          );
        }
        sucursalIdsFiltro = todas.map((r) => r.id);
      } else {
        const operable = await this.usersService.listOperableSucursalIds(
          user.sub,
          tenantId,
          appRole,
        );
        if (operable.length === 0) {
          throw new ForbiddenException(
            'No ten├®s sucursales asignadas para ver el cat├ílogo completo.',
          );
        }
        sucursalIdsFiltro = operable;
      }

      const sucursalIdRespuesta = await this.sucursalContext.resolveSucursalId();
      return {
        tenantId,
        alcance: 'tenant',
        sucursalIdsFiltro,
        sucursalIdRespuesta,
        depositoListadoId: null,
      };
    }

    const sucursalId =
      query.sucursalId ?? (await this.sucursalContext.requireSucursalId());
    return {
      tenantId,
      alcance: 'sucursal',
      sucursalIdsFiltro: [sucursalId],
      sucursalIdRespuesta: sucursalId,
      depositoListadoId: sucursalId,
    };
  }

  private async enrichRows(
    rows: Producto[],
    scope: ListScope,
    tenantId: string,
    incluirVariantes: boolean,
  ) {
    if (rows.length === 0) return [];

    const productoIds = rows.map((r) => r.id);
    const categoriaIds = [...new Set(rows.map((r) => r.categoriaId).filter(Boolean))] as string[];
    const proveedorIds = [...new Set(rows.map((r) => r.proveedorId).filter(Boolean))] as string[];
    const sucursalIds = [...new Set(rows.map((r) => r.sucursalId).filter(Boolean))] as string[];

    const [categorias, proveedores, sucursales, stockRows] = await Promise.all([
      categoriaIds.length
        ? this.categoriaRepo.find({ where: { id: In(categoriaIds), tenantId } })
        : Promise.resolve([]),
      proveedorIds.length
        ? this.proveedorRepo.find({ where: { id: In(proveedorIds), tenantId } })
        : Promise.resolve([]),
      sucursalIds.length
        ? this.sucursalRepo.find({ where: { id: In(sucursalIds), tenantId } })
        : Promise.resolve([]),
      this.loadStockOverlayRows(tenantId, productoIds, scope),
    ]);

    const stockOverlay = scope.depositoListadoId
      ? buildStockOverlayMap(stockRows)
      : scope.alcance === 'tenant'
        ? sumStockOverlayMap(stockRows)
        : undefined;

    let variantesPorProducto: Map<string, ProductoVariante[]> | undefined;
    let stockPorVariante: Map<string, number> | undefined;
    if (incluirVariantes) {
      const variantes = await this.varianteRepo.find({
        where: { tenantId, productoId: In(productoIds), activo: true },
        order: { orden: 'ASC' },
      });
      variantesPorProducto = new Map();
      for (const v of variantes) {
        const arr = variantesPorProducto.get(v.productoId) ?? [];
        arr.push(v);
        variantesPorProducto.set(v.productoId, arr);
      }

      const varianteIds = variantes.map((v) => v.id);
      if (varianteIds.length > 0) {
        const vStock = await this.varianteStockRepo.find({
          where: {
            tenantId,
            varianteId: In(varianteIds),
            sucursalId: In(scope.sucursalIdsFiltro),
          },
        });
        stockPorVariante = new Map();
        for (const row of vStock) {
          stockPorVariante.set(
            row.varianteId,
            (stockPorVariante.get(row.varianteId) ?? 0) + Number(row.stockActual),
          );
        }
      }
    }

    return enrichListProducts(rows, {
      categorias: new Map(categorias.map((c) => [c.id, c])),
      proveedores: new Map(proveedores.map((p) => [p.id, p])),
      sucursales: new Map(sucursales.map((s) => [s.id, s])),
      stockOverlay,
      depositoListadoId: scope.depositoListadoId,
      variantesPorProducto,
      stockPorVariante,
    });
  }

  private loadStockOverlayRows(tenantId: string, productoIds: string[], scope: ListScope) {
    if (scope.depositoListadoId) {
      return this.stockSucursalRepo.find({
        where: {
          tenantId,
          sucursalId: scope.depositoListadoId,
          productoId: In(productoIds),
        },
      });
    }
    if (scope.alcance === 'tenant') {
      return this.stockSucursalRepo.find({
        where: {
          tenantId,
          sucursalId: In(scope.sucursalIdsFiltro),
          productoId: In(productoIds),
        },
      });
    }
    return Promise.resolve([]);
  }

  async getById(id: string, query: GetProductoQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const includeInactive = query.includeInactive ?? false;

    const where: { id: string; tenantId: string; activo?: boolean } = { id, tenantId };
    if (!includeInactive) {
      where.activo = true;
    }

    const row = await this.productoRepo.findOne({ where });
    if (!row) {
      throw new NotFoundException('Producto no encontrado');
    }
    return { data: this.serialize(row) };
  }

  async create(dto: CreateProductoDto) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertTenantScopedRow('categoria', dto.categoriaId, tenantId);
    await this.assertTenantScopedRow('proveedor', dto.proveedorId, tenantId);

    const esPesable = dto.esPesable ?? false;
    if (dto.plu && !esPesable) {
      throw new BadRequestException('plu requiere esPesable = true');
    }

    const codigoBarras = dto.codigoBarras?.trim() || null;
    this.assertCodigoBarrasValido(codigoBarras);

    const sucursalId = await this.branchStockService.resolveDepotId();

    const entity = this.productoRepo.create({
      tenantId,
      codigo: dto.codigo.trim(),
      nombre: dto.nombre.trim(),
      descripcion: dto.descripcion ?? null,
      categoriaId: dto.categoriaId ?? null,
      proveedorId: dto.proveedorId ?? null,
      sucursalId,
      unidad: dto.unidad,
      precioCosto: this.toMoneyString(dto.precioCosto),
      precioVenta: this.toMoneyString(dto.precioVenta),
      stockActual: this.toQtyString(dto.stockActual ?? 0),
      stockMinimo: this.toQtyString(dto.stockMinimo ?? 0),
      codigoBarras,
      plu: dto.plu?.trim() || null,
      esPesable,
      fechaVencimiento: dto.fechaVencimiento ?? null,
      imagenUrl: dto.imagenUrl ?? null,
      activo: true,
    });

    try {
      const saved = await this.productoRepo.save(entity);
      return { data: this.serialize(saved) };
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }
  }

  async update(id: string, dto: UpdateProductoDto) {
    const tenantId = this.tenantContext.getTenantId();
    const existing = await this.productoRepo.findOne({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException('Producto no encontrado');
    }

    const nextCategoriaId =
      dto.categoriaId !== undefined ? (dto.categoriaId ?? null) : existing.categoriaId;
    const nextProveedorId =
      dto.proveedorId !== undefined ? (dto.proveedorId ?? null) : existing.proveedorId;
    await this.assertTenantScopedRow('categoria', nextCategoriaId, tenantId);
    await this.assertTenantScopedRow('proveedor', nextProveedorId, tenantId);

    const nextEsPesable = dto.esPesable ?? existing.esPesable;
    const nextPlu = dto.plu !== undefined ? (dto.plu?.trim() || null) : existing.plu;
    if (nextPlu && !nextEsPesable) {
      throw new BadRequestException('plu requiere esPesable = true');
    }

    const nextCodigoBarras =
      dto.codigoBarras !== undefined ? (dto.codigoBarras?.trim() || null) : existing.codigoBarras;
    this.assertCodigoBarrasValido(nextCodigoBarras);

    if (dto.codigo !== undefined) existing.codigo = dto.codigo.trim();
    if (dto.nombre !== undefined) existing.nombre = dto.nombre.trim();
    if (dto.descripcion !== undefined) existing.descripcion = dto.descripcion ?? null;
    if (dto.categoriaId !== undefined) existing.categoriaId = dto.categoriaId ?? null;
    if (dto.proveedorId !== undefined) existing.proveedorId = dto.proveedorId ?? null;
    if (dto.unidad !== undefined) existing.unidad = dto.unidad;
    if (dto.precioCosto !== undefined) existing.precioCosto = this.toMoneyString(dto.precioCosto);
    if (dto.precioVenta !== undefined) existing.precioVenta = this.toMoneyString(dto.precioVenta);
    if (dto.stockActual !== undefined) existing.stockActual = this.toQtyString(dto.stockActual);
    if (dto.stockMinimo !== undefined) existing.stockMinimo = this.toQtyString(dto.stockMinimo);
    if (dto.codigoBarras !== undefined) existing.codigoBarras = nextCodigoBarras;
    if (dto.plu !== undefined) existing.plu = dto.plu?.trim() || null;
    if (dto.esPesable !== undefined) existing.esPesable = dto.esPesable;
    if (dto.fechaVencimiento !== undefined) existing.fechaVencimiento = dto.fechaVencimiento ?? null;

    try {
      const saved = await this.productoRepo.save(existing);
      return { data: this.serialize(saved) };
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }
  }

  async softDelete(id: string) {
    const tenantId = this.tenantContext.getTenantId();
    const res = await this.productoRepo.update({ id, tenantId }, { activo: false });
    if (!res.affected) {
      throw new NotFoundException('Producto no encontrado');
    }
    return { data: { id, activo: false } };
  }

  async listBarcodes(productoId: string, query: ListProductoBarcodesQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProductoExists(productoId, tenantId);

    const includeInactive = query.includeInactive ?? false;
    const where: FindOptionsWhere<ProductoBarcode> = { tenantId, productoId };
    if (!includeInactive) {
      where.activo = true;
    }

    const rows = await this.productoBarcodeRepo.find({
      where,
      order: { esPrincipal: 'DESC', createdAt: 'ASC' },
    });

    return { data: rows.map((row) => this.serializeBarcode(row)) };
  }

  async createBarcode(productoId: string, dto: CreateProductoBarcodeDto) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProductoExists(productoId, tenantId);

    const valor = dto.valor.trim();
    this.assertBarcodePorTipoValido(dto.tipo, valor);

    if (dto.esPrincipal) {
      await this.unsetPrincipalBarcodes(tenantId, productoId);
    }

    const barcode = this.productoBarcodeRepo.create({
      tenantId,
      productoId,
      tipo: dto.tipo,
      valor,
      esPrincipal: dto.esPrincipal ?? false,
      activo: true,
    });

    try {
      const saved = await this.productoBarcodeRepo.save(barcode);
      return { data: this.serializeBarcode(saved) };
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }
  }

  async updateBarcode(productoId: string, barcodeId: string, dto: UpdateProductoBarcodeDto) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProductoExists(productoId, tenantId);

    const barcode = await this.productoBarcodeRepo.findOne({
      where: { id: barcodeId, tenantId, productoId, activo: true },
    });
    if (!barcode) {
      throw new NotFoundException('C├│digo de barras no encontrado');
    }

    const nextTipo = dto.tipo ?? barcode.tipo;
    const nextValor = dto.valor !== undefined ? dto.valor.trim() : barcode.valor;
    const nextEsPrincipal = dto.esPrincipal ?? barcode.esPrincipal;
    this.assertBarcodePorTipoValido(nextTipo, nextValor);

    if (nextEsPrincipal) {
      await this.unsetPrincipalBarcodes(tenantId, productoId, barcode.id);
    }

    barcode.tipo = nextTipo;
    barcode.valor = nextValor;
    barcode.esPrincipal = nextEsPrincipal;

    try {
      const saved = await this.productoBarcodeRepo.save(barcode);
      return { data: this.serializeBarcode(saved) };
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }
  }

  async softDeleteBarcode(productoId: string, barcodeId: string) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProductoExists(productoId, tenantId);

    const res = await this.productoBarcodeRepo.update(
      { id: barcodeId, tenantId, productoId, activo: true },
      { activo: false, esPrincipal: false },
    );
    if (!res.affected) {
      throw new NotFoundException('C├│digo de barras no encontrado');
    }

    return { data: { id: barcodeId, activo: false } };
  }

  async bulkUpdateMargin(dto: BulkMarginDto, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const operableIds = await this.requireOperableSucursalIds(user, tenantId);

    const ids = [...new Set(dto.ids.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) {
      throw new BadRequestException('Sin ids v├ílidos');
    }
    if (ids.length > MAX_IDS_BULK_LOTE) {
      throw new BadRequestException(`M├íximo ${MAX_IDS_BULK_LOTE} productos por operaci├│n`);
    }

    const porcentajeGanancia = parseGananciaPct(dto.porcentajeGanancia);
    if (porcentajeGanancia === null) {
      throw new BadRequestException('porcentajeGanancia inv├ílido (0ÔÇô999.99)');
    }

    const productos = await this.productoRepo.find({
      where: {
        id: In(ids),
        tenantId,
        activo: true,
        sucursalId: In(operableIds),
      },
      select: {
        id: true,
        sucursalId: true,
        precioCosto: true,
        ivaPorcentaje: true,
        descuentoCostoPct: true,
      },
    });

    if (productos.length === 0) {
      throw new ConflictException(
        'No se actualiz├│ ning├║n producto (pueden estar inactivos o en una sucursal fuera de tu alcance).',
      );
    }

    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { ivaPorcentajeDefault: true, posPrefs: true },
    });
    const ivaDefault = Number(tenant?.ivaPorcentajeDefault ?? IVA_DEFAULT_PCT) || IVA_DEFAULT_PCT;
    const prefsTenantOnly = effectivePosPricingPrefs(tenant?.posPrefs ?? null, null);

    const sucursalIds = [
      ...new Set(productos.map((p) => p.sucursalId).filter((x): x is string => Boolean(x))),
    ];
    const prefsPorSucursal = new Map<string, ReturnType<typeof effectivePosPricingPrefs>>();
    if (sucursalIds.length > 0) {
      const sucursales = await this.sucursalRepo.find({
        where: { id: In(sucursalIds), tenantId },
        select: { id: true, posPrefs: true },
      });
      for (const s of sucursales) {
        prefsPorSucursal.set(s.id, effectivePosPricingPrefs(tenant?.posPrefs ?? null, s.posPrefs));
      }
    }

    let actualizados = 0;
    let sinCosto = 0;

    for (const p of productos) {
      const costo = Number(p.precioCosto ?? 0);
      const tieneCosto = Number.isFinite(costo) && costo > 0;

      const prefs =
        (p.sucursalId && prefsPorSucursal.get(p.sucursalId)) || prefsTenantOnly;

      const patch: Partial<Producto> = {
        porcentajeGanancia: porcentajeGanancia.toFixed(2),
      };

      if (tieneCosto) {
        const precioVenta = calcularPrecioVenta(
          costo,
          porcentajeGanancia,
          p.ivaPorcentaje != null ? Number(p.ivaPorcentaje) : null,
          ivaDefault,
          {
            redondearPreciosCentenas: prefs.redondearPreciosCentenas,
            redondearMenores100ADecenas: prefs.redondearMenores100ADecenas,
            descuentoCostoPct:
              p.descuentoCostoPct != null ? Number(p.descuentoCostoPct) : null,
          },
        );
        patch.precioVenta = precioVenta.toFixed(2);
      } else {
        sinCosto += 1;
      }

      const res = await this.productoRepo.update({ id: p.id, tenantId }, patch);
      if (res.affected) {
        actualizados += 1;
      }
    }

    if (actualizados === 0) {
      throw new BadRequestException('No se pudo actualizar la ganancia');
    }

    return { data: { actualizados, sinCosto } };
  }

  async bulkUpdateActiveByFilter(dto: BulkByFilterDto, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const operableIds = await this.requireOperableSucursalIds(user, tenantId);
    const reactivar = dto.activo === true;
    const darDeBaja = dto.activo === false;

    if (!reactivar && !darDeBaja) {
      throw new BadRequestException('activo debe ser true o false');
    }

    const filtros = dto.filtros ?? ({} as BulkByFilterDto['filtros']);
    const proveedorIds = assertProveedorFiltersValid(filtros);

    if (filtros.stockBajo) {
      throw new BadRequestException(
        'La baja masiva por filtros no admite stockBajo. Quit├í ese filtro.',
      );
    }
    if (darDeBaja && filtros.onlyInactive) {
      throw new BadRequestException('No pod├®s dar de baja productos que ya est├ín inactivos.');
    }
    if (reactivar && !filtros.onlyInactive) {
      throw new BadRequestException(
        'Para reactivar masivamente activ├í el filtro de productos dados de baja.',
      );
    }
    if (filtros.proveedorExcluirId) {
      throw new BadRequestException(
        'La baja masiva por filtros no admite proveedorExcluirId. Us├í la selecci├│n manual.',
      );
    }
    if (!proveedorIds?.length) {
      throw new BadRequestException(
        'Por ahora la baja masiva por filtros requiere al menos un proveedor. Seleccion├í los productos manualmente o filtr├í por proveedor.',
      );
    }

    const listQuery: ListProductsQueryDto = {
      ...filtros,
      onlyInactive: filtros.onlyInactive ?? false,
      includeInactive: filtros.onlyInactive ?? false,
    };

    const scope = await this.resolveListScope(listQuery, user, tenantId);
    const qb = applyListFilters(this.productoRepo.createQueryBuilder('p'), {
      tenantId,
      scope,
      query: listQuery,
      proveedorIds,
    });

    const total = await qb.getCount();
    if (total > MAX_BULK_FILTRO) {
      throw new BadRequestException(
        `Hay demasiados productos (${total}). El m├íximo por operaci├│n es ${MAX_BULK_FILTRO}. Acot├í el filtro.`,
      );
    }

    if (total === 0) {
      throw new ConflictException(
        reactivar
          ? 'No se reactiv├│ ning├║n producto con esos filtros.'
          : 'No se dio de baja ning├║n producto con esos filtros.',
      );
    }

    const rows = await qb.select(['p.id']).getMany();
    const ids = rows.map((r) => r.id);

    let actualizados = 0;
    for (let i = 0; i < ids.length; i += MAX_IDS_BULK_LOTE) {
      const lote = ids.slice(i, i + MAX_IDS_BULK_LOTE);
      const res = await this.productoRepo.update(
        {
          id: In(lote),
          tenantId,
          sucursalId: In(operableIds),
          activo: !reactivar,
        },
        { activo: reactivar },
      );
      actualizados += res.affected ?? 0;
    }

    if (actualizados === 0) {
      throw new ConflictException(
        reactivar
          ? 'No se reactiv├│ ning├║n producto. Suele pasar si el dep├│sito del cat├ílogo no est├í entre tus sucursales operables.'
          : 'No se dio de baja ning├║n producto. Suele pasar si el dep├│sito del cat├ílogo no es operable para tu usuario.',
      );
    }

    return { data: { actualizados, total } };
  }

  private async requireOperableSucursalIds(
    user: AccessTokenPayload,
    tenantId: string,
  ): Promise<string[]> {
    const appRole = resolveAppRole(user);
    const ids = await this.usersService.listOperableSucursalIds(user.sub, tenantId, appRole);
    if (ids.length === 0) {
      throw new ForbiddenException('No ten├®s sucursales operables para esta acci├│n.');
    }
    return ids;
  }

  async generateInternalBarcode(productId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const productoId = productId;
    const producto = await this.productoRepo.findOne({
      where: { id: productoId, tenantId, activo: true },
    });
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    if (producto.esPesable) {
      throw new BadRequestException('Los productos pesables no usan c├│digo de barras (us├í PLU).');
    }

    if (producto.codigoBarras) {
      throw new BadRequestException(
        'El producto ya tiene un c├│digo de barras asignado. Eliminalo primero para generar uno nuevo.',
      );
    }

    const tieneBarcodeTabla = await this.productoBarcodeRepo.exist({
      where: { tenantId, productoId, activo: true },
    });
    if (tieneBarcodeTabla) {
      throw new BadRequestException(
        'El producto ya tiene un c├│digo de barras asignado. Eliminalo primero para generar uno nuevo.',
      );
    }

    const maxCodigo = await this.resolveMaxInternalBarcode(tenantId);
    const nuevoCodigo = generarEAN13Interno(siguienteSecuencialInterno(maxCodigo));

    producto.codigoBarras = nuevoCodigo;
    await this.unsetPrincipalBarcodes(tenantId, productId);

    const barcodeRow = this.productoBarcodeRepo.create({
      tenantId,
      productoId,
      tipo: ProductoBarcodeTipo.EAN13,
      valor: nuevoCodigo,
      esPrincipal: true,
      activo: true,
    });

    try {
      const saved = await this.productoRepo.save(producto);
      await this.productoBarcodeRepo.save(barcodeRow);
      return {
        data: {
          product: this.serialize(saved),
          generatedBarcode: nuevoCodigo,
        },
      };
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }
  }

  private async resolveMaxInternalBarcode(tenantId: string): Promise<string | null> {
    const [maxProducto, maxBarcode] = await Promise.all([
      this.productoRepo
        .createQueryBuilder('p')
        .select('MAX(p.codigo_barras)', 'max')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.activo = true')
        .andWhere("p.codigo_barras LIKE '135%'")
        .getRawOne<{ max: string | null }>(),
      this.productoBarcodeRepo
        .createQueryBuilder('b')
        .select('MAX(b.valor)', 'max')
        .where('b.tenant_id = :tenantId', { tenantId })
        .andWhere('b.activo = true')
        .andWhere("b.valor LIKE '135%'")
        .getRawOne<{ max: string | null }>(),
    ]);

    const a = maxProducto?.max ?? null;
    const b = maxBarcode?.max ?? null;
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  private serialize(p: Producto) {
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
      ivaPorcentaje: p.ivaPorcentaje != null ? Number(p.ivaPorcentaje) : null,
      porcentajeGanancia: p.porcentajeGanancia != null ? Number(p.porcentajeGanancia) : null,
      descuentoCostoPct: p.descuentoCostoPct != null ? Number(p.descuentoCostoPct) : null,
      stockActual: Number(p.stockActual),
      stockMinimo: Number(p.stockMinimo),
      codigoBarras: p.codigoBarras,
      plu: p.plu,
      esPesable: p.esPesable,
      fechaVencimiento: p.fechaVencimiento,
      imagenUrl: p.imagenUrl,
      activo: p.activo,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private serializeBarcode(barcode: ProductoBarcode) {
    return {
      id: barcode.id,
      tenantId: barcode.tenantId,
      productoId: barcode.productoId,
      tipo: barcode.tipo,
      valor: barcode.valor,
      esPrincipal: barcode.esPrincipal,
      activo: barcode.activo,
      createdAt: barcode.createdAt.toISOString(),
      updatedAt: barcode.updatedAt.toISOString(),
    };
  }

  private toMoneyString(n: number): string {
    return n.toFixed(2);
  }

  private toQtyString(n: number): string {
    return n.toFixed(3);
  }

  private assertCodigoBarrasValido(codigoBarras: string | null): void {
    if (!codigoBarras) return;

    const tipo = inferBarcodeTipoByLength(codigoBarras);
    if (!isValidBarcodeByTipo(tipo, codigoBarras)) {
      throw new BadRequestException('codigoBarras inv├ílido: longitud/tipo/checksum');
    }
  }

  private assertBarcodePorTipoValido(tipo: ProductoBarcodeTipo, valor: string): void {
    if (!valor) {
      throw new BadRequestException('valor de c├│digo de barras requerido');
    }
    if (!isValidBarcodeByTipo(tipo, valor)) {
      throw new BadRequestException('barcode inv├ílido para el tipo/checksum');
    }
  }

  private async assertTenantScopedRow(
    table: 'categoria' | 'proveedor',
    id: string | null | undefined,
    tenantId: string,
  ): Promise<void> {
    if (!id) return;
    const row = await this.productoRepo.manager
      .createQueryBuilder()
      .select('1')
      .from(table, 't')
      .where('t.id = :id', { id })
      .andWhere('t.tenant_id = :tenantId', { tenantId })
      .getRawOne();
    if (!row) {
      throw new BadRequestException(`${table} inv├ílida para el tenant`);
    }
  }

  private async resolveProductIdsByBarcode(
    tenantId: string,
    barcode: string,
    includeInactive: boolean,
  ): Promise<string[]> {
    const [barcodeRows, legacyRows] = await Promise.all([
      this.productoBarcodeRepo.find({
        where: { tenantId, valor: barcode, activo: true },
        select: { productoId: true },
      }),
      this.productoRepo.find({
        where: {
          tenantId,
          codigoBarras: barcode,
          ...(includeInactive ? {} : { activo: true }),
        },
        select: { id: true },
      }),
    ]);

    const ids = new Set<string>();
    for (const row of barcodeRows) ids.add(row.productoId);
    for (const row of legacyRows) ids.add(row.id);
    return [...ids];
  }

  private async assertProductoExists(productoId: string, tenantId: string): Promise<void> {
    const exists = await this.productoRepo.exist({ where: { id: productoId, tenantId } });
    if (!exists) {
      throw new NotFoundException('Producto no encontrado');
    }
  }

  private async unsetPrincipalBarcodes(
    tenantId: string,
    productoId: string,
    skipBarcodeId?: string,
  ): Promise<void> {
    const where: FindOptionsWhere<ProductoBarcode> = {
      tenantId,
      productoId,
      activo: true,
      esPrincipal: true,
    };

    if (skipBarcodeId) {
      const principals = await this.productoBarcodeRepo.find({ where });
      await Promise.all(
        principals
          .filter((row) => row.id !== skipBarcodeId)
          .map((row) => this.productoBarcodeRepo.update({ id: row.id }, { esPrincipal: false })),
      );
      return;
    }

    await this.productoBarcodeRepo.update(where, { esPrincipal: false });
  }

  private rethrowUniqueViolation(err: unknown): void {
    if (err instanceof QueryFailedError) {
      const code = (err as QueryFailedError & { driverError?: { code?: string } }).driverError?.code;
      if (code === '23505') {
        throw new ConflictException(
          'Violaci├│n de unicidad (c├│digo, PLU, barcode por tenant o barcode principal)',
        );
      }
    }
  }
}
