import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Producto } from '../products/entities/producto.entity';
import { aplanarRepresentativosVentaPorOrden } from './utils/ventas-representativas.util';
import {
  CustomerDebtQueryDto,
  ReportPeriodQueryDto,
  SupplierReplenishmentQueryDto,
  SupplierSpendQueryDto,
} from './dto/report-period-query.dto';
import {
  diasCalendarioInclusivos,
  resolverPeriodoReporte,
  rangoPrevio,
  ymdArgentina,
} from './utils/periodo-reporte.util';
import {
  addCalendarDays,
  quiebreStock,
  redondearCantidadSugerida,
} from './utils/reposicion-proveedor.util';
import {
  csvEscape,
  esVenta,
  esVentaOTipoAjuste,
  excluidoDeAgregadoVentas,
  incluirLineaVenta,
  round2,
  signoPorTipo,
} from './utils/report-comprobante-rules.util';

type EstadoCuentaCliente = 'al_dia' | 'con_deuda' | 'vencido' | 'saldo_a_favor';
type EstadoFiltro = 'todos' | EstadoCuentaCliente;

@Injectable()
export class ReportsAdvancedService {
  constructor(
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem) private readonly compItemRepo: Repository<ComprobanteItem>,
    @InjectRepository(CuentaCorriente) private readonly cuentaRepo: Repository<CuentaCorriente>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(StockSucursal) private readonly stockSucursalRepo: Repository<StockSucursal>,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async getSupplierReplenishment(query: SupplierReplenishmentQueryDto) {
    await this.assertFacturadorSimple();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const periodo = resolverPeriodoReporte(this.queryRecord(query), { defaultKey: 'mes' });
    const diasPeriodo = diasCalendarioInclusivos(periodo.desde, periodo.hasta);
    const categoriaId = query.categoriaId?.trim() || '';
    const proveedorId = query.proveedorId?.trim() || '';
    const filtro = (query.filtro ?? 'sugerencias').toLowerCase() === 'todos' ? 'todos' : 'sugerencias';
    const sinProveedor = (query.sinProveedor ?? '1').trim() !== '0';
    const diasObjetivo = Math.min(120, Math.max(1, query.diasObjetivo ?? 14));

    const qb = this.compItemRepo
      .createQueryBuilder('ci')
      .innerJoin(Comprobante, 'c', 'c.id = ci.comprobante_id')
      .innerJoin(Producto, 'p', 'p.id = ci.producto_id')
      .leftJoin(Categoria, 'cat', 'cat.id = p.categoria_id')
      .leftJoin(Proveedor, 'prov', 'prov.id = p.proveedor_id')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.estado = :estado', { estado: EstadoComprobante.emitido })
      .andWhere('c.fecha >= :desde', { desde: periodo.desde })
      .andWhere('c.fecha <= :hasta', { hasta: periodo.hasta })
      .select([
        'ci.cantidad AS cantidad',
        'p.id AS prod_id',
        'p.codigo AS codigo',
        'p.nombre AS nombre',
        'p.unidad AS unidad',
        'p.stock_actual AS stock_actual',
        'p.stock_minimo AS stock_minimo',
        'p.proveedor_id AS proveedor_id',
        'p.categoria_id AS categoria_id',
        'cat.nombre AS categoria_nombre',
        'prov.nombre AS proveedor_nombre',
        'c.tipo AS tipo',
        'c.sucursal_id AS sucursal_id',
      ]);

    if (sucursalId) qb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });

    const rawRows = await qb.getRawMany<{
      cantidad: string;
      prod_id: string;
      codigo: string;
      nombre: string;
      unidad: string;
      stock_actual: string;
      stock_minimo: string;
      proveedor_id: string | null;
      categoria_id: string | null;
      categoria_nombre: string | null;
      proveedor_nombre: string | null;
      tipo: string;
      sucursal_id: string | null;
    }>();

    type Agg = {
      producto_id: string;
      codigo: string;
      nombre: string;
      unidad: string;
      categoria_nombre: string | null;
      proveedor_id: string | null;
      proveedor_nombre: string | null;
      stock_actual: number;
      stock_minimo: number;
      unidades_periodo: number;
    };

    const agg = new Map<string, Agg>();

    for (const raw of rawRows) {
      if (!incluirLineaVenta(raw.tipo)) continue;
      if (sucursalId && raw.sucursal_id !== sucursalId) continue;
      if (categoriaId && raw.categoria_id !== categoriaId) continue;
      if (proveedorId && raw.proveedor_id !== proveedorId) continue;
      if (!sinProveedor && raw.proveedor_id == null) continue;

      const sign = signoPorTipo(raw.tipo);
      const cant = Number(raw.cantidad) * sign;
      const prev =
        agg.get(raw.prod_id) ??
        ({
          producto_id: raw.prod_id,
          codigo: raw.codigo,
          nombre: raw.nombre,
          unidad: raw.unidad,
          categoria_nombre: raw.categoria_nombre,
          proveedor_id: raw.proveedor_id,
          proveedor_nombre: raw.proveedor_nombre,
          stock_actual: Number(raw.stock_actual),
          stock_minimo: Number(raw.stock_minimo),
          unidades_periodo: 0,
        } satisfies Agg);

      prev.unidades_periodo += cant;
      prev.stock_actual = Number(raw.stock_actual);
      prev.stock_minimo = Number(raw.stock_minimo);
      prev.proveedor_id = raw.proveedor_id;
      prev.proveedor_nombre = raw.proveedor_nombre;
      agg.set(raw.prod_id, prev);
    }

    if (sucursalId && agg.size > 0) {
      const stockRows = await this.stockSucursalRepo.find({
        where: { tenantId, sucursalId, productoId: In(Array.from(agg.keys())) },
      });
      const stockMap = new Map(stockRows.map((s) => [s.productoId, s]));
      for (const r of agg.values()) {
        const ss = stockMap.get(r.producto_id);
        if (ss) {
          r.stock_actual = Number(ss.stockActual);
          r.stock_minimo = Number(ss.stockMinimo);
        }
      }
    }

    type ProdCatalog = {
      id: string;
      codigo: string;
      nombre: string;
      stock_actual: number;
      stock_minimo: number;
      proveedor_id: string | null;
      categoria_id: string | null;
      unidad: string;
      categoria_nombre: string | null;
      proveedor_nombre: string | null;
    };

    let prodCatalog: ProdCatalog[] = [];

    if (sucursalId) {
      const ssRaw = await this.stockSucursalRepo
        .createQueryBuilder('ss')
        .innerJoin(Producto, 'p', 'p.id = ss.producto_id')
        .leftJoin(Categoria, 'cat', 'cat.id = p.categoria_id')
        .leftJoin(Proveedor, 'prov', 'prov.id = p.proveedor_id')
        .where('ss.tenant_id = :tenantId', { tenantId })
        .andWhere('ss.sucursal_id = :sucursalId', { sucursalId })
        .andWhere('p.activo = true')
        .select([
          'ss.stock_actual AS stock_actual',
          'ss.stock_minimo AS stock_minimo',
          'p.id AS prod_id',
          'p.codigo AS codigo',
          'p.nombre AS nombre',
          'p.proveedor_id AS proveedor_id',
          'p.categoria_id AS categoria_id',
          'p.unidad AS unidad',
          'cat.nombre AS categoria_nombre',
          'prov.nombre AS proveedor_nombre',
        ])
        .getRawMany<{
          stock_actual: string;
          stock_minimo: string;
          prod_id: string;
          codigo: string;
          nombre: string;
          proveedor_id: string | null;
          categoria_id: string | null;
          unidad: string;
          categoria_nombre: string | null;
          proveedor_nombre: string | null;
        }>();

      prodCatalog = ssRaw.map((row) => ({
        id: row.prod_id,
        codigo: row.codigo,
        nombre: row.nombre,
        stock_actual: Number(row.stock_actual),
        stock_minimo: Number(row.stock_minimo),
        proveedor_id: row.proveedor_id,
        categoria_id: row.categoria_id,
        unidad: row.unidad,
        categoria_nombre: row.categoria_nombre,
        proveedor_nombre: row.proveedor_nombre,
      }));
    } else {
      const pq = this.productoRepo
        .createQueryBuilder('p')
        .leftJoin(Categoria, 'cat', 'cat.id = p.categoria_id')
        .leftJoin(Proveedor, 'prov', 'prov.id = p.proveedor_id')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.activo = true')
        .select([
          'p.id AS prod_id',
          'p.codigo AS codigo',
          'p.nombre AS nombre',
          'p.stock_actual AS stock_actual',
          'p.stock_minimo AS stock_minimo',
          'p.proveedor_id AS proveedor_id',
          'p.categoria_id AS categoria_id',
          'p.unidad AS unidad',
          'cat.nombre AS categoria_nombre',
          'prov.nombre AS proveedor_nombre',
        ]);
      if (proveedorId) pq.andWhere('p.proveedor_id = :proveedorId', { proveedorId });
      if (categoriaId) pq.andWhere('p.categoria_id = :categoriaId', { categoriaId });
      const products = await pq.getRawMany<{
        prod_id: string;
        codigo: string;
        nombre: string;
        stock_actual: string;
        stock_minimo: string;
        proveedor_id: string | null;
        categoria_id: string | null;
        unidad: string;
        categoria_nombre: string | null;
        proveedor_nombre: string | null;
      }>();
      prodCatalog = products.map((p) => ({
        id: p.prod_id,
        codigo: p.codigo,
        nombre: p.nombre,
        stock_actual: Number(p.stock_actual),
        stock_minimo: Number(p.stock_minimo),
        proveedor_id: p.proveedor_id,
        categoria_id: p.categoria_id,
        unidad: p.unidad,
        categoria_nombre: p.categoria_nombre,
        proveedor_nombre: p.proveedor_nombre,
      }));
    }

    if (proveedorId) prodCatalog = prodCatalog.filter((p) => p.proveedor_id === proveedorId);
    if (categoriaId) prodCatalog = prodCatalog.filter((p) => p.categoria_id === categoriaId);

    for (const prod of prodCatalog) {
      if (!sinProveedor && prod.proveedor_id == null) continue;
      if (!quiebreStock(prod.stock_actual, prod.stock_minimo)) continue;
      if (agg.has(prod.id)) continue;
      agg.set(prod.id, {
        producto_id: prod.id,
        codigo: prod.codigo,
        nombre: prod.nombre,
        unidad: prod.unidad,
        categoria_nombre: prod.categoria_nombre,
        proveedor_id: prod.proveedor_id,
        proveedor_nombre: prod.proveedor_nombre,
        stock_actual: prod.stock_actual,
        stock_minimo: prod.stock_minimo,
        unidades_periodo: 0,
      });
    }

    const hoy = ymdArgentina();

    type Fila = {
      producto_id: string;
      codigo: string;
      nombre: string;
      unidad: string;
      categoria: string | null;
      proveedor_id: string | null;
      proveedor: string | null;
      unidades_periodo: number;
      consumo_diario: number | null;
      dias_cobertura: number | null;
      fecha_agot_estimada: string | null;
      stock_actual: number;
      stock_minimo: number;
      quiebre: boolean;
      dias_objetivo: number;
      cantidad_sugerida: number;
      motivos: string[];
    };

    const filasRaw: Fila[] = [];

    for (const r of agg.values()) {
      const unidadesNetas = Math.max(0, r.unidades_periodo);
      const consumoDiario = unidadesNetas > 0 ? unidadesNetas / diasPeriodo : null;
      const diasCobertura =
        consumoDiario != null && consumoDiario > 1e-9 ? r.stock_actual / consumoDiario : null;
      const fechaAgot =
        diasCobertura != null && Number.isFinite(diasCobertura) && consumoDiario != null && consumoDiario > 0
          ? addCalendarDays(hoy, Math.max(0, Math.floor(diasCobertura)))
          : null;

      const targetPorRitmo = consumoDiario != null && consumoDiario > 0 ? consumoDiario * diasObjetivo : 0;
      const desdeObjetivo = Math.max(0, targetPorRitmo - r.stock_actual);
      const desdeMinimo = Math.max(0, r.stock_minimo - r.stock_actual);
      const cantidadSugerida = redondearCantidadSugerida(Math.max(desdeObjetivo, desdeMinimo));

      const motivos: string[] = [];
      const qFlag = quiebreStock(r.stock_actual, r.stock_minimo);
      if (qFlag) motivos.push('bajo_minimo');
      if (consumoDiario != null && consumoDiario > 0 && diasCobertura != null && diasCobertura < diasObjetivo) {
        motivos.push('baja_cobertura');
      }
      if (r.unidades_periodo <= 0 && qFlag) motivos.push('sin_ventas_periodo');

      filasRaw.push({
        producto_id: r.producto_id,
        codigo: r.codigo,
        nombre: r.nombre,
        unidad: r.unidad,
        categoria: r.categoria_nombre,
        proveedor_id: r.proveedor_id,
        proveedor: r.proveedor_nombre,
        unidades_periodo: round2(r.unidades_periodo),
        consumo_diario: consumoDiario != null ? round2(consumoDiario) : null,
        dias_cobertura: diasCobertura != null && Number.isFinite(diasCobertura) ? round2(diasCobertura) : null,
        fecha_agot_estimada: fechaAgot,
        stock_actual: r.stock_actual,
        stock_minimo: r.stock_minimo,
        quiebre: qFlag,
        dias_objetivo: diasObjetivo,
        cantidad_sugerida: cantidadSugerida,
        motivos,
      });
    }

    const filasFiltradas =
      filtro === 'todos'
        ? filasRaw.filter((f) => sinProveedor || f.proveedor_id != null)
        : filasRaw.filter((f) => {
            if (!sinProveedor && f.proveedor_id == null) return false;
            return (
              f.cantidad_sugerida > 0 ||
              f.quiebre ||
              (f.consumo_diario != null &&
                f.consumo_diario > 0 &&
                f.dias_cobertura != null &&
                f.dias_cobertura < diasObjetivo)
            );
          });

    filasFiltradas.sort((a, b) => {
      const pa = (a.proveedor ?? '\uffff').localeCompare(b.proveedor ?? '\uffff', 'es');
      if (pa !== 0) return pa;
      return a.codigo.localeCompare(b.codigo, 'es');
    });

    const limite = filtro === 'todos' ? 500 : filasFiltradas.length;
    const filas = filasFiltradas.slice(0, limite);

    if ((query.export ?? '').toLowerCase() === 'csv') {
      const header =
        'proveedor,codigo,nombre,unidad,categoria,unidades_periodo,consumo_diario,dias_cobertura,fecha_agot_estimada,stock_actual,stock_minimo,quiebre,dias_objetivo,cantidad_sugerida,motivos';
      const lines = [
        header,
        ...filas.map((it) =>
          [
            csvEscape(it.proveedor ?? ''),
            csvEscape(it.codigo),
            csvEscape(it.nombre),
            csvEscape(it.unidad),
            csvEscape(it.categoria ?? ''),
            csvEscape(it.unidades_periodo),
            csvEscape(it.consumo_diario ?? ''),
            csvEscape(it.dias_cobertura ?? ''),
            csvEscape(it.fecha_agot_estimada ?? ''),
            csvEscape(it.stock_actual),
            csvEscape(it.stock_minimo),
            csvEscape(it.quiebre ? 'si' : 'no'),
            csvEscape(it.dias_objetivo),
            csvEscape(it.cantidad_sugerida),
            csvEscape(it.motivos.join(';')),
          ].join(','),
        ),
      ];
      return {
        csv: lines.join('\n'),
        filename: `reposicion-proveedor-${periodo.desde}-${periodo.hasta}.csv`,
      };
    }

    return {
      data: {
        sucursal_id: sucursalId,
        periodo,
        parametros: {
          dias_analisis: diasPeriodo,
          dias_objetivo_cobertura: diasObjetivo,
          filtro,
          sin_proveedor: sinProveedor,
          categoria_id: categoriaId || null,
          proveedor_id: proveedorId || null,
        },
        indicadores: {
          articulos: filas.length,
          con_sugerencia_positiva: filas.filter((f) => f.cantidad_sugerida > 0).length,
        },
        nota:
          'Consumo seg├║n l├¡neas de comprobantes emitidos (tickets y facturas; notas de cr├®dito restan). Con sucursal seleccionada, las l├¡neas se filtran por la sucursal del comprobante y el stock/m├¡nimo mostrado es el de ese dep├│sito (stock_sucursal). Sin cobranza_factura en Nest: aging de clientes no aplica aqu├¡.',
        filas,
      },
    };
  }

  async getNetProfits(query: ReportPeriodQueryDto) {
    await this.assertFacturadorSimple();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const periodo = resolverPeriodoReporte(this.queryRecord(query), { defaultKey: 'mes' });
    const { desde, hasta } = periodo;

    const comprobantes = await this.comprobanteRepo.find({
      where: {
        tenantId,
        estado: EstadoComprobante.emitido,
        fecha: Between(desde, hasta),
        ...(sucursalId ? { sucursalId } : {}),
      },
      select: { id: true, fecha: true, tipo: true, total: true, numeroOrden: true },
    });

    let ventasNetas = 0;
    const ventasDiarias = new Map<string, number>();
    const comprobantesNetos = aplanarRepresentativosVentaPorOrden(
      comprobantes.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        numeroOrden: c.numeroOrden,
        total: Number(c.total),
        fecha: c.fecha,
      })),
    );

    for (const c of comprobantesNetos) {
      const tipo = c.tipo;
      if (excluidoDeAgregadoVentas(tipo)) continue;
      const signed = tipo.startsWith('nota_credito_') ? -Number(c.total) : Number(c.total);
      if (!esVenta(tipo) && !tipo.startsWith('nota_credito_')) continue;
      ventasNetas += signed;
      ventasDiarias.set(c.fecha, (ventasDiarias.get(c.fecha) ?? 0) + signed);
    }

    const costoQb = this.compItemRepo
      .createQueryBuilder('ci')
      .innerJoin(Comprobante, 'c', 'c.id = ci.comprobante_id')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.estado = :estado', { estado: EstadoComprobante.emitido })
      .andWhere('c.fecha >= :desde', { desde })
      .andWhere('c.fecha <= :hasta', { hasta })
      .select(['ci.cantidad AS cantidad', 'ci.precio_costo AS precio_costo', 'c.fecha AS fecha', 'c.tipo AS tipo']);
    if (sucursalId) costoQb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });
    const costoRows = await costoQb.getRawMany<{
      cantidad: string;
      precio_costo: string | null;
      fecha: string;
      tipo: string;
    }>();

    let costoMercaderia = 0;
    const costoDiario = new Map<string, number>();
    for (const row of costoRows) {
      const tipo = row.tipo;
      if (!esVenta(tipo) && !tipo.startsWith('nota_credito_')) continue;
      const signed = tipo.startsWith('nota_credito_') ? -1 : 1;
      const costo = Number(row.precio_costo ?? 0) * Number(row.cantidad) * signed;
      costoMercaderia += costo;
      costoDiario.set(row.fecha, (costoDiario.get(row.fecha) ?? 0) + costo);
    }

    const margenBruto = ventasNetas - costoMercaderia;
    const margenPct = ventasNetas === 0 ? null : round2((margenBruto / ventasNetas) * 100);

    const fechas = Array.from(new Set([...ventasDiarias.keys(), ...costoDiario.keys()])).sort((a, b) =>
      a.localeCompare(b),
    );
    const serie = fechas.map((fecha) => {
      const ventas = round2(ventasDiarias.get(fecha) ?? 0);
      const costo = round2(costoDiario.get(fecha) ?? 0);
      return { fecha, ventas, costo, margen: round2(ventas - costo) };
    });

    if ((query.export ?? '').toLowerCase() === 'csv') {
      const lines = [
        'fecha,ventas,costo,margen',
        ...serie.map((it) =>
          [csvEscape(it.fecha), csvEscape(it.ventas), csvEscape(it.costo), csvEscape(it.margen)].join(','),
        ),
      ];
      return {
        csv: lines.join('\n'),
        filename: `reporte-ganancias-netas-${desde}-${hasta}.csv`,
      };
    }

    return {
      data: {
        sucursal_id: sucursalId,
        periodo,
        resumen: {
          ventas_netas: round2(ventasNetas),
          costo_mercaderia: round2(costoMercaderia),
          margen_bruto: round2(margenBruto),
          margen_pct: margenPct,
        },
        serie,
      },
    };
  }

  async getSupplierSpend(query: SupplierSpendQueryDto) {
    await this.assertFacturadorSimple();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const periodo = resolverPeriodoReporte(this.queryRecord(query), { defaultKey: 'mes' });
    const { desde, hasta, key } = periodo;
    const prev = rangoPrevio(desde, hasta);
    const proveedorIdFiltro = query.proveedorId?.trim() || '';

    const proveedoresRows = await this.proveedorRepo.find({
      where: { tenantId },
      select: { id: true, nombre: true },
    });

    const qb = this.compItemRepo
      .createQueryBuilder('ci')
      .innerJoin(Comprobante, 'c', 'c.id = ci.comprobante_id')
      .innerJoin(Producto, 'p', 'p.id = ci.producto_id')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.estado = :estado', { estado: EstadoComprobante.emitido })
      .andWhere('c.fecha >= :prevDesde', { prevDesde: prev.desde })
      .andWhere('c.fecha <= :hasta', { hasta })
      .select([
        'ci.cantidad AS cantidad',
        'ci.precio_costo AS precio_costo',
        'c.fecha AS fecha',
        'c.tipo AS tipo',
        'p.proveedor_id AS proveedor_id',
      ]);
    if (sucursalId) qb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });
    const itemsRows = await qb.getRawMany<{
      cantidad: string;
      precio_costo: string | null;
      fecha: string;
      tipo: string;
      proveedor_id: string | null;
    }>();

    const nombres = new Map(proveedoresRows.map((p) => [p.id, p.nombre]));
    const actual = new Map<string, number>();
    const anterior = new Map<string, number>();

    for (const row of itemsRows) {
      if (!row.proveedor_id) continue;
      if (proveedorIdFiltro && row.proveedor_id !== proveedorIdFiltro) continue;
      if (!esVentaOTipoAjuste(row.tipo)) continue;

      const costo = Number(row.precio_costo ?? 0) * Number(row.cantidad);
      const signed = row.tipo.startsWith('nota_credito_') ? -costo : costo;
      const fecha = row.fecha;
      if (fecha >= desde && fecha <= hasta) {
        actual.set(row.proveedor_id, (actual.get(row.proveedor_id) ?? 0) + signed);
      } else if (fecha >= prev.desde && fecha <= prev.hasta) {
        anterior.set(row.proveedor_id, (anterior.get(row.proveedor_id) ?? 0) + signed);
      }
    }

    const ids = new Set<string>([...actual.keys(), ...anterior.keys()]);
    const items = Array.from(ids)
      .map((id) => {
        const gastoActual = round2(actual.get(id) ?? 0);
        const gastoAnterior = round2(anterior.get(id) ?? 0);
        const variacionAbsoluta = round2(gastoActual - gastoAnterior);
        const variacionPct =
          gastoAnterior === 0 ? null : round2(((gastoActual - gastoAnterior) / gastoAnterior) * 100);
        return {
          proveedor_id: id,
          proveedor_nombre: nombres.get(id) ?? 'Proveedor',
          gasto_actual: gastoActual,
          gasto_anterior: gastoAnterior,
          variacion_abs: variacionAbsoluta,
          variacion_pct: variacionPct,
        };
      })
      .sort((a, b) => b.gasto_actual - a.gasto_actual);

    if ((query.export ?? '').toLowerCase() === 'csv') {
      const lines = [
        'proveedor_id,proveedor,gasto_actual,gasto_anterior,variacion_abs,variacion_pct',
        ...items.map((it) =>
          [
            csvEscape(it.proveedor_id),
            csvEscape(it.proveedor_nombre),
            csvEscape(it.gasto_actual),
            csvEscape(it.gasto_anterior),
            csvEscape(it.variacion_abs),
            csvEscape(it.variacion_pct ?? ''),
          ].join(','),
        ),
      ];
      return {
        csv: lines.join('\n'),
        filename: `reporte-proveedores-${desde}-${hasta}.csv`,
      };
    }

    const totalActual = round2(items.reduce((acc, it) => acc + it.gasto_actual, 0));
    const totalAnterior = round2(items.reduce((acc, it) => acc + it.gasto_anterior, 0));
    const variacionTotalAbs = round2(totalActual - totalAnterior);
    const variacionTotalPct =
      totalAnterior === 0 ? null : round2(((totalActual - totalAnterior) / totalAnterior) * 100);

    return {
      data: {
        sucursal_id: sucursalId,
        periodo: { key, desde, hasta },
        comparativo: { desde: prev.desde, hasta: prev.hasta },
        filtro: { proveedor_id: proveedorIdFiltro || null },
        items,
        resumen: {
          total_actual: totalActual,
          total_anterior: totalAnterior,
          variacion_abs: variacionTotalAbs,
          variacion_pct: variacionTotalPct,
        },
        proveedores: proveedoresRows.map((p) => ({ id: p.id, nombre: p.nombre })),
      },
    };
  }

  async getCustomerDebt(query: CustomerDebtQueryDto) {
    await this.assertFacturadorSimple();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const estado = this.normalizarEstado(query.estado);

    const cuentas = await this.cuentaRepo.find({
      where: { tenantId, tipoCuenta: 'cliente' },
      select: { clienteId: true, saldo: true },
    });

    const clienteIds = cuentas.map((c) => c.clienteId).filter(Boolean) as string[];
    const clientes =
      clienteIds.length > 0
        ? await this.clienteRepo.find({
            where: { tenantId, id: In(clienteIds) },
            select: { id: true, nombre: true, razonSocial: true },
          })
        : [];
    const clienteMap = new Map(clientes.map((c) => [c.id, c]));

    const porCliente = new Map<
      string,
      {
        cliente_id: string;
        cliente_nombre: string;
        saldo_total: number;
        estado: EstadoCuentaCliente;
        aging_0_30: number;
        aging_31_60: number;
        aging_61_plus: number;
        facturas_abiertas: number;
        facturas_vencidas: number;
        ultimo_vencimiento_at: string | null;
      }
    >();

    for (const row of cuentas) {
      if (!row.clienteId) continue;
      const cli = clienteMap.get(row.clienteId);
      if (!cli) continue;
      const nombre = cli.razonSocial || cli.nombre;
      const saldo = Number(row.saldo);
      porCliente.set(row.clienteId, {
        cliente_id: row.clienteId,
        cliente_nombre: nombre,
        saldo_total: saldo,
        estado: saldo > 0 ? 'con_deuda' : 'al_dia',
        aging_0_30: 0,
        aging_31_60: 0,
        aging_61_plus: 0,
        facturas_abiertas: 0,
        facturas_vencidas: 0,
        ultimo_vencimiento_at: null,
      });
    }

    for (const acc of porCliente.values()) {
      if (acc.saldo_total < -0.01) {
        acc.estado = 'saldo_a_favor';
      } else if (acc.saldo_total <= 0.01) {
        acc.estado = 'al_dia';
      } else if (acc.facturas_vencidas > 0) {
        acc.estado = 'vencido';
      } else {
        acc.estado = 'con_deuda';
      }
      acc.saldo_total = round2(acc.saldo_total);
      acc.aging_0_30 = round2(acc.aging_0_30);
      acc.aging_31_60 = round2(acc.aging_31_60);
      acc.aging_61_plus = round2(acc.aging_61_plus);
    }

    const items = Array.from(porCliente.values())
      .filter((it) => estado === 'todos' || it.estado === estado)
      .sort((a, b) => b.saldo_total - a.saldo_total);

    const resumen = {
      deuda_total: round2(items.reduce((acc, it) => acc + (it.saldo_total > 0 ? it.saldo_total : 0), 0)),
      clientes_deudores: items.filter((it) => it.saldo_total > 0).length,
      vencidos: items.filter((it) => it.estado === 'vencido').length,
      saldo_a_favor_total: round2(
        items.reduce((acc, it) => acc + (it.saldo_total < 0 ? Math.abs(it.saldo_total) : 0), 0),
      ),
      clientes_con_saldo_a_favor: items.filter((it) => it.saldo_total < 0).length,
    };

    if ((query.export ?? '').toLowerCase() === 'csv') {
      const lines = [
        'cliente,estado,saldo,aging_0_30,aging_31_60,aging_61_plus,facturas_abiertas,facturas_vencidas',
        ...items.map((it) =>
          [
            csvEscape(it.cliente_nombre),
            csvEscape(it.estado),
            csvEscape(it.saldo_total),
            csvEscape(it.aging_0_30),
            csvEscape(it.aging_31_60),
            csvEscape(it.aging_61_plus),
            csvEscape(it.facturas_abiertas),
            csvEscape(it.facturas_vencidas),
          ].join(','),
        ),
      ];
      return {
        csv: lines.join('\n'),
        filename: `reporte-clientes-deuda-${estado}.csv`,
      };
    }

    return {
      data: {
        sucursal_id: sucursalId,
        items,
        resumen,
        nota:
          sucursalId != null
            ? 'Aging por factura no disponible en Nest (falta cobranza_factura). Se usa saldo de cuenta_corriente global del cliente.'
            : 'Aging por factura no disponible en Nest (falta cobranza_factura). Saldo desde cuenta_corriente.',
      },
    };
  }

  private normalizarEstado(input?: string): EstadoFiltro {
    switch ((input ?? '').toLowerCase()) {
      case 'al_dia':
        return 'al_dia';
      case 'con_deuda':
        return 'con_deuda';
      case 'vencido':
        return 'vencido';
      case 'saldo_a_favor':
        return 'saldo_a_favor';
      default:
        return 'todos';
    }
  }

  private queryRecord(
    query: SupplierReplenishmentQueryDto | SupplierSpendQueryDto | CustomerDebtQueryDto | ReportPeriodQueryDto,
  ) {
    return {
      periodo: query.periodo,
      desde: query.desde,
      hasta: query.hasta,
      sucursal_id: query.sucursalId,
    };
  }

  private async assertFacturadorSimple(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.facturadorSimple) {
      throw new ForbiddenException('Los reportes no est├ín habilitados para tu plan.');
    }
  }
}
