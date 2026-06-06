import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { AiLimitService } from '../../ai/ai-limit.service';
import { TenantContext } from '../../auth/tenant-context.service';
import { Categoria } from '../../catalog/entities/categoria.entity';
import { Proveedor } from '../../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../../config/entities/modulo-config.entity';
import { Sucursal } from '../../branches/entities/sucursal.entity';
import { ImportacionLog } from '../../importaciones/entities/importacion-log.entity';
import { OrigenPrecio } from '../../pricing/enums/origen-precio.enum';
import { PrecioHistorial } from '../../pricing/entities/precio-historial.entity';
import { Producto } from '../../products/entities/producto.entity';
import { ApplyPriceListDto } from './dto/apply-price-list.dto';
import { ConfirmPriceListDto } from './dto/confirm-price-list.dto';
import { ListPriceListsQueryDto } from './dto/list-price-lists-query.dto';
import {
  CloneBranchDto,
  CompareListsDto,
  PatchSimulateDto,
} from './dto/price-list-compare-simulate.dto';
import { ListaPreciosItem } from './entities/lista-precios-item.entity';
import { ListaPrecios } from './entities/lista-precios.entity';
import { EstadoListaPrecios } from './enums/estado-lista-precios.enum';
import {
  clampDescuentoPct,
  costoNetoDesdeLista,
  margenPct,
  round2,
  sugerirPrecioVentaCliente,
  variacionPct,
} from './utils/descuento-proveedor.util';
import { ejecutarMatching } from './utils/lista-matching.util';
import { matchPorIA } from './utils/lista-matching-ia.util';
import {
  detectarOportunidadesFromListas,
  type ListaHistoricaRow,
} from './utils/opportunity-alerts.util';
import {
  armarComparacionListas,
  cruzarPorProductoId,
  type ItemConProveedor,
} from './utils/comparar-listas.util';
import { cruzarListasConIA } from './utils/comparar-listas-ia.util';
import { compararTemporalFromData } from './utils/comparar-temporal.util';
import { RadarInflacion } from '../entities/radar-inflacion.entity';

@Injectable()
export class PriceListsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ListaPrecios)
    private readonly listaRepo: Repository<ListaPrecios>,
    @InjectRepository(ListaPreciosItem)
    private readonly itemRepo: Repository<ListaPreciosItem>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(PrecioHistorial)
    private readonly historialRepo: Repository<PrecioHistorial>,
    @InjectRepository(RadarInflacion)
    private readonly radarRepo: Repository<RadarInflacion>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(ImportacionLog)
    private readonly importLogRepo: Repository<ImportacionLog>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
    private readonly aiLimitService: AiLimitService,
  ) {}

  async list(query: ListPriceListsQueryDto) {
    await this.assertImportadorExcel();
    const tenantId = this.tenantContext.getTenantId();

    const where: Record<string, unknown> = { tenantId };
    if (query.proveedor_id) where.proveedorId = query.proveedor_id;
    if (query.estado) where.estado = query.estado;

    const rows = await this.listaRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });

    const provIds = [...new Set(rows.map((r) => r.proveedorId))];
    const proveedores =
      provIds.length > 0
        ? await this.proveedorRepo.find({
            where: { tenantId, id: In(provIds) },
            select: { id: true, nombre: true },
          })
        : [];
    const provMap = new Map(proveedores.map((p) => [p.id, p.nombre]));

    return {
      data: rows.map((r) => this.serializeLista(r, provMap.get(r.proveedorId))),
    };
  }

  async getById(id: string) {
    await this.assertImportadorExcel();
    const lista = await this.findListaOrThrow(id);
    const proveedor = await this.proveedorRepo.findOne({
      where: { tenantId: lista.tenantId, id: lista.proveedorId },
      select: { id: true, nombre: true },
    });
    const items = await this.itemRepo.find({
      where: { tenantId: lista.tenantId, listaId: lista.id },
      order: { createdAt: 'ASC' },
    });

    return {
      data: {
        ...this.serializeLista(lista, proveedor?.nombre),
        items: items.map((i) => this.serializeItem(i)),
      },
    };
  }

  async confirm(dto: ConfirmPriceListDto) {
    await this.assertImportadorExcel();
    const tenantId = this.tenantContext.getTenantId();

    const proveedor = await this.proveedorRepo.findOne({
      where: { tenantId, id: dto.proveedor_id },
      select: { id: true },
    });
    if (!proveedor) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    for (const item of dto.items) {
      if (!(item.nombre_raw ?? item.nombre)?.trim()) {
        throw new BadRequestException('Cada item debe incluir nombre o nombre_raw');
      }
    }

    const pct = clampDescuentoPct(dto.descuento_proveedor_pct ?? 0);
    const nombreLista = dto.nombre?.trim() || dto.nombre_archivo?.trim() || 'Lista de precios';
    const archivoRef = dto.storage_path?.trim() || dto.archivo_url?.trim() || null;

    const lista = await this.listaRepo.save(
      this.listaRepo.create({
        tenantId,
        proveedorId: dto.proveedor_id,
        sucursalId: dto.sucursal_id ?? null,
        nombre: nombreLista,
        descuentoProveedorPctCarga: String(pct),
        archivoUrl: archivoRef,
        totalItems: dto.items.length,
        itemsMatcheados: 0,
        estado: EstadoListaPrecios.Pendiente,
      }),
    );

    const itemEntities = dto.items.map((item) => {
      const nombre = (item.nombre_raw ?? item.nombre ?? '').trim();
      const neto = costoNetoDesdeLista(item.precio_lista, pct);
      return this.itemRepo.create({
        tenantId,
        listaId: lista.id,
        codigoProveedor: item.codigo_proveedor?.trim() || null,
        nombreProveedor: nombre,
        precioLista: String(neto),
        precioNeto: String(neto),
      });
    });
    await this.itemRepo.save(itemEntities);

    const prov = await this.proveedorRepo.findOne({
      where: { id: dto.proveedor_id },
      select: { nombre: true },
    });

    return {
      data: {
        lista: this.serializeLista(lista, prov?.nombre),
        total_items: dto.items.length,
      },
    };
  }

  async runMatching(listaId: string, usuarioId: string) {
    await this.assertImportadorExcel();
    const lista = await this.findListaOrThrow(listaId);
    if (lista.estado === EstadoListaPrecios.Aplicada) {
      throw new BadRequestException('La lista ya fue aplicada');
    }

    const tenantId = lista.tenantId;
    const items = await this.itemRepo.find({ where: { tenantId, listaId } });
    const productos = await this.productoRepo.find({
      where: { tenantId, activo: true },
      select: { id: true, codigo: true, nombre: true },
    });

    const base = ejecutarMatching(
      items.map((i) => ({
        id: i.id,
        codigoProveedor: i.codigoProveedor,
        nombreProveedor: i.nombreProveedor,
      })),
      productos.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre })),
    );

    let iaMatches = base.matches;
    let sinMatch = base.sinMatch;
    let iaUsada = false;

    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (modulos?.iaPrecios && base.sinMatch.length > 0) {
      const limite = await this.aiLimitService.verificarLimiteIA('ia_pdf');
      if (limite.permitido) {
        const usados = new Set(base.matches.map((m) => m.productoId));
        const disponibles = productos
          .map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre }))
          .filter((p) => !usados.has(p.id));
        const fuzzy = await matchPorIA(base.sinMatch, disponibles);
        if (fuzzy.length > 0) {
          iaUsada = true;
          await this.importLogRepo.save(
            this.importLogRepo.create({
              tenantId,
              proveedorId: lista.proveedorId,
              archivoNombre: `[IA matching] lista ${listaId}`,
              origen: OrigenPrecio.ia_pdf,
              totalFilas: 0,
              filasExitosas: 0,
              filasConError: 0,
              productosCreados: 0,
              productosActualizados: 0,
              detalleErrores: null,
              usuarioId,
            }),
          );
        }
        const fuzzyItemIds = new Set(fuzzy.map((m) => m.itemId));
        iaMatches = [...base.matches, ...fuzzy];
        sinMatch = base.sinMatch.filter((i) => !fuzzyItemIds.has(i.id));
      }
    }

    const matchMap = new Map(iaMatches.map((m) => [m.itemId, m]));
    for (const item of items) {
      const match = matchMap.get(item.id);
      item.productoId = match?.productoId ?? null;
    }
    await this.itemRepo.save(items);

    lista.itemsMatcheados = iaMatches.length;
    await this.listaRepo.save(lista);

    const updatedItems = await this.itemRepo.find({ where: { tenantId, listaId } });

    return {
      data: {
        matcheados: updatedItems.filter((i) => i.productoId).map((i) => this.serializeItem(i)),
        sin_match: updatedItems.filter((i) => !i.productoId).map((i) => this.serializeItem(i)),
        resumen: {
          total: items.length,
          seguros: iaMatches.length,
          sin_match: sinMatch.length,
          ia_usada: iaUsada,
        },
      },
    };
  }

  async runAnalysis(listaId: string) {
    await this.assertAnalizador();
    const lista = await this.findListaOrThrow(listaId);
    const tenantId = lista.tenantId;

    const items = await this.itemRepo.find({ where: { tenantId, listaId } });
    const matched = items.filter((i) => i.productoId);
    const unmatched = items.filter((i) => !i.productoId);

    if (matched.length === 0) {
      throw new BadRequestException(
        'No hay items matcheados para analizar. Ejecut├í el matching primero.',
      );
    }

    const productoIds = matched.map((i) => i.productoId!);
    const productos = await this.productoRepo.find({
      where: { tenantId, id: In(productoIds) },
      select: { id: true, precioCosto: true, precioVenta: true, categoriaId: true },
    });
    const prodMap = new Map(productos.map((p) => [p.id, p]));

    const catIds = [...new Set(productos.map((p) => p.categoriaId).filter(Boolean))] as string[];
    const categorias =
      catIds.length > 0
        ? await this.categoriaRepo.find({
            where: { tenantId, id: In(catIds) },
            select: { id: true, nombre: true },
          })
        : [];
    const catMap = new Map(categorias.map((c) => [c.id, c.nombre]));

    let sumVariacion = 0;
    let sumCostoAnterior = 0;
    let sumVentaActual = 0;
    let sumCostoNuevo = 0;
    let conAumento = 0;
    let conBaja = 0;
    let sinCambio = 0;

    const categoriaBuckets = new Map<
      string | null,
      { catNombre: string; variaciones: number[]; aumento: number; baja: number; sinCambio: number }
    >();

    const itemsAnalizados: Record<string, unknown>[] = [];

    for (const item of matched) {
      const prod = prodMap.get(item.productoId!);
      if (!prod) {
        unmatched.push(item);
        continue;
      }

      const costoAnterior = Number(prod.precioCosto);
      const costoNuevo = Number(item.precioLista);
      const ventaActual = Number(prod.precioVenta);

      const variacion = variacionPct(costoAnterior, costoNuevo);
      const margenAnterior = margenPct(costoAnterior, ventaActual);
      const margenNuevo = margenPct(costoNuevo, ventaActual);
      const sugerido = sugerirPrecioVentaCliente(costoNuevo, costoAnterior, ventaActual);

      item.precioCostoActual = String(round2(costoAnterior));
      item.variacionPct = String(round2(variacion));
      item.margenActualPct = String(round2(margenAnterior));
      item.margenNuevoPct = String(round2(margenNuevo));
      item.precioVentaSugerido = String(sugerido);

      const catNombre = prod.categoriaId
        ? (catMap.get(prod.categoriaId) ?? 'Sin categor├¡a')
        : 'Sin categor├¡a';

      itemsAnalizados.push({
        ...this.serializeItem(item),
        categoria_nombre: catNombre,
      });

      sumVariacion += variacion;
      sumCostoAnterior += costoAnterior;
      sumVentaActual += ventaActual;
      sumCostoNuevo += costoNuevo;

      if (variacion > 0.01) conAumento++;
      else if (variacion < -0.01) conBaja++;
      else sinCambio++;

      const catKey = prod.categoriaId;
      if (!categoriaBuckets.has(catKey)) {
        categoriaBuckets.set(catKey, {
          catNombre,
          variaciones: [],
          aumento: 0,
          baja: 0,
          sinCambio: 0,
        });
      }
      const bucket = categoriaBuckets.get(catKey)!;
      bucket.variaciones.push(variacion);
      if (variacion > 0.01) bucket.aumento++;
      else if (variacion < -0.01) bucket.baja++;
      else bucket.sinCambio++;
    }

    await this.itemRepo.save(matched);

    const totalMatcheados = itemsAnalizados.length;
    const variacionPromedio = totalMatcheados > 0 ? sumVariacion / totalMatcheados : 0;
    const margenGlobalAnterior =
      sumCostoAnterior > 0 ? margenPct(sumCostoAnterior, sumVentaActual) : 0;
    const margenGlobalNuevo = sumCostoNuevo > 0 ? margenPct(sumCostoNuevo, sumVentaActual) : 0;

    const impactoPorCategoria = [...categoriaBuckets.entries()].map(([catId, b]) => ({
      categoria_id: catId,
      categoria_nombre: b.catNombre,
      items: b.variaciones.length,
      variacion_promedio_pct: round2(
        b.variaciones.reduce((s, v) => s + v, 0) / b.variaciones.length,
      ),
      items_con_aumento: b.aumento,
      items_con_baja: b.baja,
      items_sin_cambio: b.sinCambio,
    }));

    lista.estado = EstadoListaPrecios.Analizada;
    lista.variacionPromedioPct = String(round2(variacionPromedio));
    lista.itemsConAumento = conAumento;
    lista.margenGlobalAnteriorPct = String(round2(margenGlobalAnterior));
    lista.margenGlobalNuevoPct = String(round2(margenGlobalNuevo));
    await this.listaRepo.save(lista);

    const descuentoAlCargar = Number(lista.descuentoProveedorPctCarga);

    return {
      data: {
        items_analizados: itemsAnalizados,
        items_sin_match: unmatched.map((i) => this.serializeItem(i)),
        metricas_globales: {
          variacion_promedio_pct: round2(variacionPromedio),
          margen_global_anterior_pct: round2(margenGlobalAnterior),
          margen_global_nuevo_pct: round2(margenGlobalNuevo),
          items_con_aumento: conAumento,
          items_con_baja: conBaja,
          items_sin_cambio: sinCambio,
          total_matcheados: totalMatcheados,
          total_sin_match: unmatched.length,
        },
        impacto_por_categoria: impactoPorCategoria,
        descuento_proveedor_disponible:
          descuentoAlCargar > 0
            ? { pct: round2(descuentoAlCargar), vigente: true, fuente: 'proveedor' as const }
            : null,
      },
    };
  }

  async apply(listaId: string, dto: ApplyPriceListDto) {
    await this.assertAnalizador();
    const lista = await this.findListaOrThrow(listaId);
    if (lista.estado !== EstadoListaPrecios.Analizada) {
      throw new BadRequestException('La lista debe estar en estado analizada antes de aplicar');
    }

    const tenantId = lista.tenantId;
    const ventaOverrides = new Map(
      (dto.precios_venta ?? []).map((p) => [p.item_id, p.precio_venta]),
    );

    const allItems = await this.itemRepo
      .createQueryBuilder('i')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.lista_id = :listaId', { listaId })
      .andWhere('i.producto_id IS NOT NULL')
      .getMany();

    if (allItems.length === 0) {
      throw new BadRequestException('No hay items matcheados para aplicar');
    }

    const itemsAplicar = allItems.filter((i) => i.seleccionado);
    const itemsOmitidos = allItems.length - itemsAplicar.length;

    let actualizados = 0;
    const errores: { item_id: string; nombre: string; error: string }[] = [];

    for (const item of itemsAplicar) {
      try {
        const producto = await this.productoRepo.findOne({
          where: { tenantId, id: item.productoId! },
        });
        if (!producto) {
          errores.push({
            item_id: item.id,
            nombre: item.nombreProveedor,
            error: 'Producto no encontrado',
          });
          continue;
        }

        const nuevoCosto = Number(item.precioLista);
        const ventaOverride = ventaOverrides.get(item.id);
        const nuevaVenta =
          ventaOverride ??
          (item.precioVentaDecidido != null
            ? Number(item.precioVentaDecidido)
            : item.precioVentaSugerido
              ? Number(item.precioVentaSugerido)
              : null);

        const costoAnteriorHist = Number(producto.precioCosto);
        const ventaAnteriorHist = Number(producto.precioVenta);
        const ventaNuevaHist = nuevaVenta ?? ventaAnteriorHist;

        producto.precioCosto = String(nuevoCosto);
        if (nuevaVenta != null) {
          producto.precioVenta = String(nuevaVenta);
        }
        await this.productoRepo.save(producto);

        await this.historialRepo.save(
          this.historialRepo.create({
            tenantId,
            productoId: producto.id,
            precioCostoAnterior: String(costoAnteriorHist),
            precioCostoNuevo: String(nuevoCosto),
            precioVentaAnterior: String(ventaAnteriorHist),
            precioVentaNuevo: String(ventaNuevaHist),
            margenAnterior: String(margenPct(costoAnteriorHist, ventaAnteriorHist)),
            margenNuevo: String(margenPct(nuevoCosto, ventaNuevaHist)),
            origen: OrigenPrecio.lista_precios,
            createdAt: new Date(),
          }),
        );

        actualizados++;
      } catch (e) {
        errores.push({
          item_id: item.id,
          nombre: item.nombreProveedor,
          error: (e as Error).message,
        });
      }
    }

    if (dto.contribuir_radar && lista.variacionPromedioPct != null) {
      const proveedor = await this.proveedorRepo.findOne({
        where: { id: lista.proveedorId },
        select: { nombre: true },
      });
      if (proveedor) {
        await this.contribuirRadar(
          proveedor.nombre,
          Number(lista.variacionPromedioPct),
          lista.totalItems,
        );
      }
    }

    const esParcial = dto.parcial || itemsOmitidos > 0 || errores.length > 0;
    lista.estado = EstadoListaPrecios.Aplicada;
    lista.aplicadaAt = new Date();
    await this.listaRepo.save(lista);

    return {
      data: {
        actualizados,
        omitidos: itemsOmitidos,
        errores,
        estado_lista: esParcial ? 'aplicada_parcial' : 'aplicada_total',
      },
    };
  }

  async compararTemporal(proveedorId: string) {
    await this.assertAnalizador();
    const tenantId = this.tenantContext.getTenantId();

    const proveedor = await this.proveedorRepo.findOne({
      where: { tenantId, id: proveedorId },
      select: { id: true, nombre: true },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');

    const listas = await this.listaRepo.find({
      where: {
        tenantId,
        proveedorId,
        estado: In([EstadoListaPrecios.Analizada, EstadoListaPrecios.Aplicada]),
      },
      order: { createdAt: 'ASC' },
    });

    if (listas.length < 2) {
      throw new BadRequestException(
        'Se necesitan al menos 2 listas analizadas del mismo proveedor para comparar',
      );
    }

    const listaIds = listas.map((l) => l.id);
    const allItems = await this.itemRepo.find({
      where: { tenantId, listaId: In(listaIds) },
      select: {
        listaId: true,
        productoId: true,
        precioLista: true,
        variacionPct: true,
      },
    });
    const matchedItems = allItems.filter((i) => i.productoId);

    const productoIds = [...new Set(matchedItems.map((i) => i.productoId!))];
    const productos =
      productoIds.length > 0
        ? await this.productoRepo.find({
            where: { tenantId, id: In(productoIds) },
            select: { id: true, nombre: true },
          })
        : [];
    const productoNombres = new Map(productos.map((p) => [p.id, p.nombre]));

    return compararTemporalFromData(
      proveedor.id,
      proveedor.nombre,
      listas.map((l) => ({
        id: l.id,
        createdAt: l.createdAt,
        nombre: l.nombre,
        variacionPromedioPct: l.variacionPromedioPct,
        totalItems: l.totalItems,
        itemsConAumento: l.itemsConAumento,
      })),
      matchedItems.map((i) => ({
        listaId: i.listaId,
        productoId: i.productoId!,
        precioLista: i.precioLista,
        variacionPct: i.variacionPct,
      })),
      productoNombres,
    );
  }

  async compararListas(dto: CompareListsDto, userId: string) {
    await this.assertAnalizador();
    const tenantId = this.tenantContext.getTenantId();
    const listaIds = dto.lista_ids;

    const listas = await this.listaRepo.find({
      where: { tenantId, id: In(listaIds) },
    });
    if (listas.length < 2) {
      throw new BadRequestException('No se encontraron suficientes listas');
    }

    const provIds = [...new Set(listas.map((l) => l.proveedorId))];
    const proveedores = await this.proveedorRepo.find({
      where: { tenantId, id: In(provIds) },
      select: { id: true, nombre: true },
    });
    const provNombreMap = new Map(proveedores.map((p) => [p.id, p.nombre]));

    const itemsPorLista = new Map<string, ItemConProveedor[]>();

    for (const lista of listas) {
      const items = await this.itemRepo.find({
        where: { tenantId, listaId: lista.id },
        order: { createdAt: 'ASC' },
      });
      const mapped: ItemConProveedor[] = items.map((it) => ({
        lista_id: lista.id,
        proveedor_id: lista.proveedorId,
        proveedor_nombre: provNombreMap.get(lista.proveedorId) ?? lista.proveedorId,
        item_id: it.id,
        nombre_raw: it.nombreProveedor,
        nombre_normalizado: it.nombreNormalizado,
        codigo_proveedor: it.codigoProveedor,
        precio_lista: Number(it.precioLista),
        producto_id: it.productoId,
      }));
      itemsPorLista.set(lista.id, mapped);
    }

    const { grupos: gruposDet, sinCruzar } = cruzarPorProductoId(itemsPorLista);

    let gruposIA = new Map<string, ItemConProveedor[]>();
    let iaUsada = false;

    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (modulos?.iaPrecios && sinCruzar.length > 0) {
      const limite = await this.aiLimitService.verificarLimiteIA('ia_pdf');
      if (limite.permitido) {
        gruposIA = await cruzarListasConIA(sinCruzar);
        if (gruposIA.size > 0) {
          iaUsada = true;
          await this.importLogRepo.save(
            this.importLogRepo.create({
              tenantId,
              proveedorId: null,
              archivoNombre: '[IA cross-matching] comparaci├│n de listas',
              origen: OrigenPrecio.ia_pdf,
              totalFilas: 0,
              filasExitosas: 0,
              filasConError: 0,
              productosCreados: 0,
              productosActualizados: 0,
              detalleErrores: null,
              usuarioId: userId,
            }),
          );
        }
      }
    }

    const prodIds = [...gruposDet.keys()];
    const prodNombreMap = new Map<string, string>();
    if (prodIds.length > 0) {
      const prods = await this.productoRepo.find({
        where: { tenantId, id: In(prodIds) },
        select: { id: true, nombre: true },
      });
      for (const p of prods) prodNombreMap.set(p.id, p.nombre);
    }

    const proveedoresInfo = listas.map((l) => ({
      id: l.proveedorId,
      nombre: provNombreMap.get(l.proveedorId) ?? l.proveedorId,
      lista_id: l.id,
    }));

    return armarComparacionListas(
      gruposDet,
      gruposIA,
      prodNombreMap,
      proveedoresInfo,
      iaUsada,
    );
  }

  async getSimulate(listaId: string) {
    await this.assertAnalizador();
    const lista = await this.findListaOrThrow(listaId);
    const tenantId = lista.tenantId;

    const items = await this.itemRepo
      .createQueryBuilder('i')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.lista_id = :listaId', { listaId })
      .andWhere('i.producto_id IS NOT NULL')
      .orderBy('i.created_at', 'ASC')
      .getMany();

    const productoIds = [...new Set(items.map((i) => i.productoId!))];
    const productos =
      productoIds.length > 0
        ? await this.productoRepo.find({
            where: { tenantId, id: In(productoIds) },
            select: { id: true, precioVenta: true },
          })
        : [];
    const ventaMap = new Map(productos.map((p) => [p.id, Number(p.precioVenta)]));

    return {
      lista: {
        id: lista.id,
        estado: lista.estado,
        variacion_promedio_pct:
          lista.variacionPromedioPct != null ? Number(lista.variacionPromedioPct) : null,
        margen_global_anterior_pct:
          lista.margenGlobalAnteriorPct != null ? Number(lista.margenGlobalAnteriorPct) : null,
        margen_global_nuevo_pct:
          lista.margenGlobalNuevoPct != null ? Number(lista.margenGlobalNuevoPct) : null,
      },
      items: items.map((it) => this.serializeItemSimulate(it, ventaMap.get(it.productoId!) ?? null)),
    };
  }

  async patchSimulate(listaId: string, dto: PatchSimulateDto) {
    await this.assertAnalizador();
    await this.findListaOrThrow(listaId);
    const tenantId = this.tenantContext.getTenantId();

    let updated = 0;
    for (const entry of dto.items) {
      const update: Partial<ListaPreciosItem> = {};
      if (entry.precio_venta_decidido !== undefined) {
        update.precioVentaDecidido =
          entry.precio_venta_decidido != null ? String(entry.precio_venta_decidido) : null;
      }
      if (entry.incluir_en_aplicacion !== undefined) {
        update.seleccionado = entry.incluir_en_aplicacion;
      }
      if (Object.keys(update).length === 0) continue;

      const result = await this.itemRepo.update(
        { id: entry.item_id, listaId, tenantId },
        update,
      );
      if (result.affected) updated += 1;
    }

    return { updated };
  }

  async cloneBranch(listaId: string, dto: CloneBranchDto, _userId: string) {
    await this.assertImportadorExcel();
    const tenantId = this.tenantContext.getTenantId();
    const dest = dto.sucursal_destino_id.trim();

    const lista = await this.findListaOrThrow(listaId);
    if (!lista.sucursalId) {
      throw new BadRequestException(
        'La lista no tiene sucursal de origen; reimport├í o asign├í sucursal en soporte.',
      );
    }
    if (lista.sucursalId === dest) {
      throw new BadRequestException(
        'Eleg├¡ otra sucursal: la lista ya corresponde a esa sucursal de carga.',
      );
    }

    const sucDest = await this.sucursalRepo.findOne({
      where: { id: dest, tenantId, activa: true },
    });
    if (!sucDest) {
      throw new NotFoundException('Sucursal de destino no encontrada o inactiva.');
    }

    const items = await this.itemRepo.find({ where: { tenantId, listaId: lista.id } });

    return this.dataSource.transaction(async (manager) => {
      const nombreCopia = `${lista.nombre.slice(0, 180)} (copia)`;
      const nueva = manager.create(ListaPrecios, {
        tenantId,
        sucursalId: dest,
        proveedorId: lista.proveedorId,
        nombre: nombreCopia,
        estado: EstadoListaPrecios.Pendiente,
        descuentoProveedorPctCarga: lista.descuentoProveedorPctCarga,
        archivoUrl: null,
        totalItems: items.length,
        itemsMatcheados: 0,
        itemsConAumento: 0,
        variacionPromedioPct: null,
        margenGlobalAnteriorPct: null,
        margenGlobalNuevoPct: null,
        aplicadaAt: null,
      });
      const saved = await manager.save(ListaPrecios, nueva);

      if (items.length > 0) {
        const clones = items.map((i) =>
          manager.create(ListaPreciosItem, {
            tenantId,
            listaId: saved.id,
            codigoProveedor: i.codigoProveedor,
            nombreProveedor: i.nombreProveedor,
            nombreNormalizado: i.nombreNormalizado,
            precioLista: i.precioLista,
            precioNeto: i.precioNeto,
            productoId: null,
            precioCostoActual: null,
            variacionPct: null,
            margenActualPct: null,
            margenNuevoPct: null,
            precioVentaSugerido: null,
            precioVentaDecidido: null,
            seleccionado: i.seleccionado,
          }),
        );
        await manager.save(ListaPreciosItem, clones);
      }

      return { lista_id: saved.id, items: items.length };
    });
  }

  async countPendientes(tenantId: string): Promise<number> {
    return this.listaRepo.count({
      where: {
        tenantId,
        estado: In([EstadoListaPrecios.Pendiente, EstadoListaPrecios.Analizada]),
      },
    });
  }

  async getOpportunityAlerts(tenantId: string) {
    const listas = await this.listaRepo.find({
      where: {
        tenantId,
        estado: In([EstadoListaPrecios.Analizada, EstadoListaPrecios.Aplicada]),
      },
      select: {
        proveedorId: true,
        createdAt: true,
        variacionPromedioPct: true,
      },
      order: { createdAt: 'ASC' },
    });

    const rows: ListaHistoricaRow[] = listas.map((l) => ({
      proveedorId: l.proveedorId,
      createdAt: l.createdAt,
      variacionPromedioPct:
        l.variacionPromedioPct != null ? Number(l.variacionPromedioPct) : null,
    }));

    const provIds = [...new Set(rows.map((r) => r.proveedorId))];
    const proveedores =
      provIds.length > 0
        ? await this.proveedorRepo.find({
            where: { tenantId, id: In(provIds) },
            select: { id: true, nombre: true },
          })
        : [];
    const nombresMap = new Map(proveedores.map((p) => [p.id, p.nombre]));

    return detectarOportunidadesFromListas(rows, nombresMap);
  }

  private async contribuirRadar(
    proveedorNombre: string,
    variacionPct: number,
    cantidadItems: number,
  ): Promise<void> {
    const periodo = new Date().toISOString().slice(0, 7);
    const rubro = 'general';

    const existing = await this.radarRepo.findOne({
      where: { rubro, proveedorNombre, periodo },
    });

    if (existing) {
      const prevVar = Number(existing.variacionPromedioPct);
      const prevCount = existing.cantidadListas;
      const newVar = (prevVar * prevCount + variacionPct) / (prevCount + 1);
      existing.variacionPromedioPct = String(round2(newVar));
      existing.cantidadListas = prevCount + 1;
      existing.cantidadItems += cantidadItems;
      await this.radarRepo.save(existing);
    } else {
      await this.radarRepo.save(
        this.radarRepo.create({
          rubro,
          proveedorNombre,
          periodo,
          variacionPromedioPct: String(round2(variacionPct)),
          cantidadListas: 1,
          cantidadItems,
        }),
      );
    }
  }

  private async findListaOrThrow(id: string): Promise<ListaPrecios> {
    const tenantId = this.tenantContext.getTenantId();
    const lista = await this.listaRepo.findOne({ where: { tenantId, id } });
    if (!lista) {
      throw new NotFoundException('Lista de precios no encontrada');
    }
    return lista;
  }

  private serializeItemSimulate(item: ListaPreciosItem, precioVentaActual: number | null) {
    return {
      id: item.id,
      nombre_raw: item.nombreProveedor,
      precio_lista: Number(item.precioLista),
      precio_costo_anterior:
        item.precioCostoActual != null ? Number(item.precioCostoActual) : null,
      precio_venta_actual: precioVentaActual,
      margen_anterior_pct: item.margenActualPct != null ? Number(item.margenActualPct) : null,
      precio_venta_sugerido:
        item.precioVentaSugerido != null ? Number(item.precioVentaSugerido) : null,
      precio_venta_decidido:
        item.precioVentaDecidido != null ? Number(item.precioVentaDecidido) : null,
      incluir_en_aplicacion: item.seleccionado,
      producto_id: item.productoId,
    };
  }

  private serializeLista(lista: ListaPrecios, proveedorNombre?: string) {
    return {
      id: lista.id,
      proveedor_id: lista.proveedorId,
      proveedor_nombre: proveedorNombre ?? null,
      sucursal_id: lista.sucursalId,
      nombre: lista.nombre,
      estado: lista.estado,
      descuento_proveedor_pct_carga: Number(lista.descuentoProveedorPctCarga),
      archivo_url: lista.archivoUrl,
      total_items: lista.totalItems,
      items_matcheados: lista.itemsMatcheados,
      variacion_promedio_pct:
        lista.variacionPromedioPct != null ? Number(lista.variacionPromedioPct) : null,
      aplicada_at: lista.aplicadaAt?.toISOString() ?? null,
      created_at: lista.createdAt?.toISOString() ?? null,
      updated_at: lista.updatedAt?.toISOString() ?? null,
    };
  }

  private serializeItem(item: ListaPreciosItem) {
    return {
      id: item.id,
      codigo_proveedor: item.codigoProveedor,
      nombre_proveedor: item.nombreProveedor,
      precio_lista: Number(item.precioLista),
      precio_neto: item.precioNeto != null ? Number(item.precioNeto) : null,
      producto_id: item.productoId,
      precio_costo_actual:
        item.precioCostoActual != null ? Number(item.precioCostoActual) : null,
      variacion_pct: item.variacionPct != null ? Number(item.variacionPct) : null,
      margen_actual_pct: item.margenActualPct != null ? Number(item.margenActualPct) : null,
      margen_nuevo_pct: item.margenNuevoPct != null ? Number(item.margenNuevoPct) : null,
      precio_venta_sugerido:
        item.precioVentaSugerido != null ? Number(item.precioVentaSugerido) : null,
      precio_venta_decidido:
        item.precioVentaDecidido != null ? Number(item.precioVentaDecidido) : null,
      seleccionado: item.seleccionado,
      created_at: item.createdAt?.toISOString() ?? null,
    };
  }

  private async assertImportadorExcel(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.importadorExcel) {
      throw new ForbiddenException('El m├│dulo importador_excel no est├í habilitado para tu plan.');
    }
  }

  private async assertAnalizador(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.analizadorRentabilidad) {
      throw new ForbiddenException('El m├│dulo analizador_rentabilidad no est├í habilitado para tu plan.');
    }
  }
}
