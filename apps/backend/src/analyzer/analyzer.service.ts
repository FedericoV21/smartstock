import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { TipoMovimiento } from '../inventory/enums/tipo-movimiento.enum';
import { Producto } from '../products/entities/producto.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { round2 } from '../reports/utils/report-comprobante-rules.util';
import {
  AnalyzerForecastQueryDto,
  AnalyzerMarginQueryDto,
  AnalyzerRadarQueryDto,
  AnalyzerRankingQueryDto,
} from './dto/analyzer-query.dto';
import { CierreMensual } from './entities/cierre-mensual.entity';
import { RadarInflacion } from './entities/radar-inflacion.entity';
import { calcularCierreFromLineas } from './utils/cierre-calc.util';
import { calcularMargenRealFromLineas } from './utils/margen-real.util';
import { currentPeriodo, periodoAnterior, rangoMesPeriodo } from './utils/periodo-analyzer.util';
import { calcularRankingBCGFromLineas } from './utils/ranking-bcg.util';
import { fetchVentasLineas } from './utils/ventas-lineas.util';
import { PriceListsService } from './price-lists/price-lists.service';

const LEAD_TIME_DIAS = 7;

@Injectable()
export class AnalyzerService {
  constructor(
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem) private readonly compItemRepo: Repository<ComprobanteItem>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Categoria) private readonly categoriaRepo: Repository<Categoria>,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(CierreMensual) private readonly cierreRepo: Repository<CierreMensual>,
    @InjectRepository(RadarInflacion) private readonly radarRepo: Repository<RadarInflacion>,
    @InjectRepository(Movimiento) private readonly movimientoRepo: Repository<Movimiento>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly priceListsService: PriceListsService,
  ) {}

  async getProfitabilityDashboard() {
    await this.assertAnalizador();
    const tenantId = this.tenantContext.getTenantId();
    const per = currentPeriodo();
    const cierreActual = await this.obtenerCierreMensual(tenantId, per);

    const periodos: string[] = [];
    for (let i = 5; i >= 0; i--) periodos.push(periodoAnterior(per, i));

    const cierres = await this.cierreRepo.find({
      where: { tenantId, periodo: In(periodos) },
      order: { periodo: 'ASC' },
      select: {
        periodo: true,
        ingresosBrutos: true,
        costoMercaderia: true,
        margenBruto: true,
        margenBrutoPct: true,
      },
    });
    const cierreMap = new Map(cierres.map((c) => [c.periodo, c]));

    const evolucion = periodos.map((p) => {
      const c = cierreMap.get(p);
      return {
        periodo: p,
        ingresos: c ? Number(c.ingresosBrutos) : 0,
        costos: c ? Number(c.costoMercaderia) : 0,
        margen_bruto: c ? Number(c.margenBruto) : 0,
        margen_pct: c?.margenBrutoPct != null ? Number(c.margenBrutoPct) : 0,
      };
    });

    const { desde } = rangoMesPeriodo(per);
    const comprobantes = await this.comprobanteRepo.find({
      where: {
        tenantId,
        estado: EstadoComprobante.emitido,
        fecha: Between(desde, rangoMesPeriodo(per).hasta),
      },
      select: { clienteId: true, total: true, tipo: true },
    });

    const clienteAgg = new Map<string, number>();
    for (const c of comprobantes) {
      if (!c.clienteId) continue;
      const signo = c.tipo.startsWith('nota_credito') ? -1 : 1;
      if (c.tipo === TipoComprobante.presupuesto) continue;
      clienteAgg.set(c.clienteId, (clienteAgg.get(c.clienteId) ?? 0) + Number(c.total) * signo);
    }

    const clienteIds = [...clienteAgg.keys()].slice(0, 50);
    const clientes =
      clienteIds.length > 0
        ? await this.clienteRepo.find({ where: { tenantId, id: In(clienteIds) }, select: { id: true, nombre: true } })
        : [];
    const clienteNombres = new Map(clientes.map((c) => [c.id, c.nombre]));

    const topClientes = [...clienteAgg.entries()]
      .map(([cid, total]) => ({
        cliente_id: cid,
        cliente_nombre: clienteNombres.get(cid) ?? cid,
        total: round2(total),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const listasPendientes = await this.priceListsService.countPendientes(tenantId);

    return {
      data: {
        cierre_actual: cierreActual,
        evolucion,
        listas_pendientes: listasPendientes,
        top_clientes: topClientes,
      },
    };
  }

  async getMargin(query: AnalyzerMarginQueryDto) {
    await this.assertAnalizador();
    const tenantId = this.tenantContext.getTenantId();
    const lineas = await fetchVentasLineas(this.compItemRepo, tenantId, {
      desde: query.desde,
      hasta: query.hasta,
    });
    const { productos, catMap } = await this.loadProductosYCategorias(tenantId, lineas);
    const result = calcularMargenRealFromLineas(lineas, productos, catMap, {
      productoId: query.productoId,
      categoriaId: query.categoriaId,
    });
    return { data: result };
  }

  async getRanking(query: AnalyzerRankingQueryDto) {
    await this.assertAnalizador();
    const tenantId = this.tenantContext.getTenantId();
    const lineas = await fetchVentasLineas(this.compItemRepo, tenantId, {
      desde: query.desde,
      hasta: query.hasta,
    });
    const { productos, catMap } = await this.loadProductosYCategorias(tenantId, lineas);
    const result = calcularRankingBCGFromLineas(lineas, productos, catMap, query.categoriaId);
    return { data: result };
  }

  async getForecast(query: AnalyzerForecastQueryDto) {
    await this.assertAnalizador();
    const tenantId = this.tenantContext.getTenantId();

    const pq = this.productoRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.activo = true');
    if (query.categoriaId) pq.andWhere('p.categoria_id = :categoriaId', { categoriaId: query.categoriaId });
    if (query.proveedorId) pq.andWhere('p.proveedor_id = :proveedorId', { proveedorId: query.proveedorId });
    const productos = await pq.getMany();
    if (productos.length === 0) {
      return {
        data: {
          productos: [],
          costo_total_estimado: 0,
          productos_criticos: 0,
          productos_con_estacionalidad: 0,
        },
      };
    }

    const productoIds = productos.map((p) => p.id);
    const hace12Meses = new Date();
    hace12Meses.setMonth(hace12Meses.getMonth() - 12);

    const movs = await this.movimientoRepo.find({
      where: {
        tenantId,
        tipo: TipoMovimiento.salida,
        productoId: In(productoIds),
        createdAt: Between(hace12Meses, new Date()),
      },
      select: { productoId: true, cantidad: true, createdAt: true },
    });

    const prodMovs = new Map<string, { periodo: string; mes: number; cantidad: number }[]>();
    for (const m of movs) {
      const d = m.createdAt;
      const periodo = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const mes = d.getUTCMonth() + 1;
      const arr = prodMovs.get(m.productoId) ?? [];
      const existing = arr.find((c) => c.periodo === periodo);
      if (existing) existing.cantidad += Number(m.cantidad);
      else arr.push({ periodo, mes, cantidad: Number(m.cantidad) });
      prodMovs.set(m.productoId, arr);
    }

    const provIds = [...new Set(productos.map((p) => p.proveedorId).filter(Boolean))] as string[];
    const proveedores =
      provIds.length > 0
        ? await this.proveedorRepo.find({ where: { tenantId, id: In(provIds) }, select: { id: true, nombre: true } })
        : [];
    const provNombres = new Map(proveedores.map((p) => [p.id, p.nombre]));

    const hoy = new Date();
    const mesActual = hoy.getUTCMonth() + 1;
    const resultados: Record<string, unknown>[] = [];

    for (const prod of productos) {
      const consumoMensual = prodMovs.get(prod.id) ?? [];
      if (consumoMensual.length === 0) continue;

      const totalConsumo = consumoMensual.reduce((s, c) => s + c.cantidad, 0);
      const mesesConDatos = consumoMensual.length;
      const consumoDiarioBase = totalConsumo / (mesesConDatos * 30);
      if (consumoDiarioBase <= 0) continue;

      const indices = this.calcularIndicesEstacionales(consumoMensual);
      const indiceActual = indices ? indices[mesActual - 1] : 1.0;
      const consumoDiario = consumoDiarioBase * indiceActual;

      const stockDisponible = Math.max(0, Number(prod.stockActual));
      const stockMinimo = Number(prod.stockMinimo);
      const diasRestantes = consumoDiario > 0 ? stockDisponible / consumoDiario : Infinity;

      const addDays = (days: number) => {
        const d = new Date(hoy);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };

      const fechaAgotamiento = Number.isFinite(diasRestantes)
        ? addDays(Math.floor(diasRestantes))
        : addDays(365);

      const stockHastaMinimo = Math.max(0, stockDisponible - stockMinimo);
      const diasHastaMinimo = consumoDiario > 0 ? stockHastaMinimo / consumoDiario : Infinity;
      const diasParaCompra = Math.max(0, diasHastaMinimo - LEAD_TIME_DIAS);
      const fechaSugerida = Number.isFinite(diasParaCompra) ? addDays(Math.floor(diasParaCompra)) : addDays(365);
      const cantidadSugerida = Math.ceil(consumoDiario * 30) + stockMinimo;
      const costoUnitario = Number(prod.precioCosto);
      const costoEstimado = round2(cantidadSugerida * costoUnitario);

      let urgencia: 'critica' | 'alta' | 'media' | 'baja' = 'baja';
      if (diasRestantes <= 3) urgencia = 'critica';
      else if (diasRestantes <= 7) urgencia = 'alta';
      else if (diasRestantes <= 14) urgencia = 'media';

      const provSugerido = prod.proveedorId
        ? {
            proveedor_id: prod.proveedorId,
            proveedor_nombre: provNombres.get(prod.proveedorId) ?? prod.proveedorId,
            precio_costo: costoUnitario,
            score: 0,
          }
        : null;

      resultados.push({
        producto_id: prod.id,
        producto_nombre: prod.nombre,
        categoria_id: prod.categoriaId,
        stock_actual: stockDisponible,
        stock_minimo: stockMinimo,
        consumo_diario: round2(consumoDiario),
        dias_restantes: round2(Math.min(diasRestantes, 9999)),
        fecha_agotamiento: fechaAgotamiento,
        fecha_sugerida_compra: fechaSugerida,
        cantidad_sugerida: cantidadSugerida,
        costo_estimado: costoEstimado,
        estacionalidad_detectada: indices != null,
        indice_estacional: round2(indiceActual),
        proveedor_sugerido: provSugerido,
        urgencia,
      });
    }

    const urgenciaOrden = { critica: 0, alta: 1, media: 2, baja: 3 };
    resultados.sort(
      (a, b) =>
        urgenciaOrden[a.urgencia as keyof typeof urgenciaOrden] -
          urgenciaOrden[b.urgencia as keyof typeof urgenciaOrden] ||
        (a.dias_restantes as number) - (b.dias_restantes as number),
    );

    return {
      data: {
        productos: resultados,
        costo_total_estimado: round2(
          resultados.reduce((s, p) => s + (p.costo_estimado as number), 0),
        ),
        productos_criticos: resultados.filter(
          (p) => p.urgencia === 'critica' || p.urgencia === 'alta',
        ).length,
        productos_con_estacionalidad: resultados.filter((p) => p.estacionalidad_detectada).length,
      },
    };
  }

  async getInflationRadar(query: AnalyzerRadarQueryDto) {
    await this.assertAnalizador();
    const qb = this.radarRepo.createQueryBuilder('r').orderBy('r.periodo', 'DESC');
    if (query.periodo) qb.andWhere('r.periodo = :periodo', { periodo: query.periodo });
    if (query.rubro) qb.andWhere('r.rubro = :rubro', { rubro: query.rubro });
    const rows = await qb.take(200).getMany();

    const items = rows.map((r) => ({
      rubro: r.rubro,
      proveedor_nombre: r.proveedorNombre,
      periodo: r.periodo,
      variacion_pct: Number(r.variacionPromedioPct),
      cantidad_items: r.cantidadItems,
      contribuciones: r.cantidadListas,
    }));
    const periodos = [...new Set(items.map((i) => i.periodo))].sort().reverse();

    return { data: { items, periodos } };
  }

  async getOpportunityAlerts() {
    await this.assertAnalizador();
    const tenantId = this.tenantContext.getTenantId();
    const { alertas, total } = await this.priceListsService.getOpportunityAlerts(tenantId);
    return { data: { alertas, total } };
  }

  private async obtenerCierreMensual(tenantId: string, periodo: string) {
    const existing = await this.cierreRepo.findOne({ where: { tenantId, periodo } });
    if (existing) return this.serializeCierre(existing);

    const { desde, hasta } = rangoMesPeriodo(periodo);
    const lineas = await fetchVentasLineas(this.compItemRepo, tenantId, { desde, hasta });
    const comprobantes = await this.comprobanteRepo.find({
      where: {
        tenantId,
        estado: EstadoComprobante.emitido,
        fecha: Between(desde, hasta),
      },
      select: { id: true, tipo: true },
    });
    const compCount = comprobantes.filter((c) => !c.tipo.startsWith('nota_credito')).length;

    const { productos, catMap } = await this.loadProductosYCategorias(tenantId, lineas);
    const calc = calcularCierreFromLineas(periodo, lineas, compCount, productos, catMap);

    const saved = await this.cierreRepo.save(
      this.cierreRepo.create({
        tenantId,
        periodo: calc.periodo,
        ingresosBrutos: String(calc.ingresos_brutos),
        costoMercaderia: String(calc.costo_mercaderia),
        margenBruto: String(calc.margen_bruto),
        margenBrutoPct: calc.margen_bruto_pct != null ? String(calc.margen_bruto_pct) : null,
        unidadesVendidas: calc.unidades_vendidas,
        comprobantesEmitidos: calc.comprobantes_emitidos,
        ticketPromedio: calc.ticket_promedio != null ? String(calc.ticket_promedio) : null,
        topProductos: calc.top_productos,
        porCategoria: calc.por_categoria,
      }),
    );

    return this.serializeCierre(saved);
  }

  private serializeCierre(row: CierreMensual) {
    return {
      id: row.id,
      periodo: row.periodo,
      ingresos_brutos: Number(row.ingresosBrutos),
      costo_mercaderia: Number(row.costoMercaderia),
      margen_bruto: Number(row.margenBruto),
      margen_bruto_pct: row.margenBrutoPct != null ? Number(row.margenBrutoPct) : null,
      unidades_vendidas: row.unidadesVendidas,
      comprobantes_emitidos: row.comprobantesEmitidos,
      ticket_promedio: row.ticketPromedio != null ? Number(row.ticketPromedio) : null,
      top_productos: row.topProductos ?? [],
      por_categoria: row.porCategoria ?? [],
    };
  }

  private async loadProductosYCategorias(
    tenantId: string,
    lineas: { producto_id: string }[],
  ): Promise<{
    productos: { id: string; nombre: string; categoriaId: string | null }[];
    catMap: Map<string, string>;
  }> {
    const ids = [...new Set(lineas.map((l) => l.producto_id))];
    if (ids.length === 0) return { productos: [], catMap: new Map() };

    const productos = await this.productoRepo.find({
      where: { tenantId, id: In(ids) },
      select: { id: true, nombre: true, categoriaId: true },
    });
    const catIds = [...new Set(productos.map((p) => p.categoriaId).filter(Boolean))] as string[];
    const categorias =
      catIds.length > 0
        ? await this.categoriaRepo.find({ where: { tenantId, id: In(catIds) }, select: { id: true, nombre: true } })
        : [];
    const catMap = new Map(categorias.map((c) => [c.id, c.nombre]));

    return {
      productos: productos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        categoriaId: p.categoriaId,
      })),
      catMap,
    };
  }

  private calcularIndicesEstacionales(
    consumoMensual: { periodo: string; mes: number; cantidad: number }[],
  ): number[] | null {
    if (consumoMensual.length < 12) return null;
    const porMes = new Map<number, number[]>();
    for (const cm of consumoMensual) {
      if (!porMes.has(cm.mes)) porMes.set(cm.mes, []);
      porMes.get(cm.mes)!.push(cm.cantidad);
    }
    if ([...porMes.entries()].filter(([, v]) => v.length > 0).length < 6) return null;
    const promedioGlobal =
      consumoMensual.reduce((s, c) => s + c.cantidad, 0) / consumoMensual.length;
    if (promedioGlobal <= 0) return null;

    const indices: number[] = [];
    for (let m = 1; m <= 12; m++) {
      const datos = porMes.get(m) ?? [];
      if (datos.length === 0) indices.push(1.0);
      else {
        const promMes = datos.reduce((s, v) => s + v, 0) / datos.length;
        indices.push(promMes / promedioGlobal);
      }
    }
    return indices;
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
