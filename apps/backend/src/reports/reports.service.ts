import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsSelect, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { SucursalContext } from '../branches/sucursal-context.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { ReferenciaTipo } from '../inventory/enums/referencia-tipo.enum';
import { TipoMovimiento } from '../inventory/enums/tipo-movimiento.enum';
import { Producto } from '../products/entities/producto.entity';
import { Usuario } from '../users/entities/usuario.entity';
import {
  PosConsumerSalesQueryDto,
  ReportPeriodQueryDto,
  SalesByProductQueryDto,
} from './dto/report-period-query.dto';
import {
  finDiaArgentinaIsoUtc,
  horaArgentina,
  inicioDiaArgentinaIsoUtc,
  resolverPeriodoReporte,
  resolverPeriodoReporteConLabel,
} from './utils/periodo-reporte.util';
import { diasHastaVencimiento, estadoVencimiento } from './utils/reposicion-proveedor.util';
import {
  csvEscape,
  esComprobanteVenta,
  esDocumentoIva,
  esNotaCredito,
  esVenta,
  excluidoDeAgregadoVentas,
  factorLineasVsTotalComprobante,
  round2,
} from './utils/report-comprobante-rules.util';
import { aplanarRepresentativosVentaPorOrden } from './utils/ventas-representativas.util';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem) private readonly compItemRepo: Repository<ComprobanteItem>,
    @InjectRepository(CuentaCorriente) private readonly cuentaRepo: Repository<CuentaCorriente>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(StockSucursal) private readonly stockSucursalRepo: Repository<StockSucursal>,
    @InjectRepository(Usuario) private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(Movimiento) private readonly movimientoRepo: Repository<Movimiento>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async getSummary(query: ReportPeriodQueryDto) {
    await this.assertFacturadorSimple();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const { desde, hasta, periodo, label } = resolverPeriodoReporteConLabel(
      this.queryRecord(query),
      { defaultKey: 'hoy' },
    );

    const comprobantes = await this.fetchComprobantesEmitidos(tenantId, desde, hasta, sucursalId, {
      id: true,
      total: true,
      tipo: true,
      numeroOrden: true,
    });

    const costoRows = await this.fetchCostoItems(tenantId, desde, hasta, sucursalId);
    const cuentas = await this.cuentaRepo.find({
      where: { tenantId },
      select: { saldo: true },
    });

    let facturado = 0;
    let montoFacturasFiscales = 0;
    let montoTicketsPos = 0;
    let montoNotasCredito = 0;
    let comprobantesFactura = 0;
    let comprobantesTicket = 0;
    let vendidosComprobantes = 0;

    const aplastado = aplanarRepresentativosVentaPorOrden(
      comprobantes.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        numeroOrden: c.numeroOrden,
        total: Number(c.total),
      })),
    );

    for (const c of aplastado) {
      const tipo = c.tipo;
      const total = Number(c.total);
      if (excluidoDeAgregadoVentas(tipo)) continue;
      if (esNotaCredito(tipo)) {
        facturado -= total;
        montoNotasCredito += total;
        continue;
      }
      facturado += total;
      if (tipo.startsWith('factura_')) {
        montoFacturasFiscales += total;
        comprobantesFactura += 1;
      } else if (tipo === 'ticket') {
        montoTicketsPos += total;
        comprobantesTicket += 1;
      }
      if (esComprobanteVenta(tipo)) vendidosComprobantes += 1;
    }

    let deudaCtaCte = 0;
    for (const r of cuentas) {
      const saldo = Number(r.saldo);
      if (saldo > 0) deudaCtaCte += saldo;
    }

    const gastoPorProveedor = this.aggregateGastoProveedor(costoRows);

    const proveedorIds = Array.from(gastoPorProveedor.keys());
    let topProveedores: { proveedor_id: string; nombre: string; gasto: number }[] = [];
    if (proveedorIds.length > 0) {
      const provRows = await this.proveedorRepo.find({
        where: { tenantId, id: In(proveedorIds) },
        select: { id: true, nombre: true },
      });
      const nombres = new Map(provRows.map((p) => [p.id, p.nombre]));
      topProveedores = proveedorIds
        .map((id) => ({
          proveedor_id: id,
          nombre: nombres.get(id) ?? 'Proveedor',
          gasto: round2(gastoPorProveedor.get(id) ?? 0),
        }))
        .sort((a, b) => b.gasto - a.gasto)
        .slice(0, 5);
    }

    let gastoProveedores = 0;
    for (const g of gastoPorProveedor.values()) gastoProveedores += g;

    const payload = {
      sucursal_id: sucursalId,
      periodo: { key: periodo, label, desde, hasta },
      kpis: {
        facturado: round2(facturado),
        monto_facturas_fiscales: round2(montoFacturasFiscales),
        monto_tickets_pos: round2(montoTicketsPos),
        monto_notas_credito: round2(montoNotasCredito),
        comprobantes_factura: comprobantesFactura,
        comprobantes_ticket: comprobantesTicket,
        vendidos_comprobantes: vendidosComprobantes,
        deuda_cta_cte: round2(deudaCtaCte),
        gasto_proveedores: round2(gastoProveedores),
      },
      top_proveedores: topProveedores,
    };

    if ((query.export ?? '').toLowerCase() === 'csv') {
      const lines = [
        'seccion,metrica,valor',
        `kpi,facturado,${csvEscape(payload.kpis.facturado)}`,
        `kpi,monto_facturas_fiscales,${csvEscape(payload.kpis.monto_facturas_fiscales)}`,
        `kpi,monto_tickets_pos,${csvEscape(payload.kpis.monto_tickets_pos)}`,
        `kpi,monto_notas_credito,${csvEscape(payload.kpis.monto_notas_credito)}`,
        `kpi,comprobantes_factura,${csvEscape(payload.kpis.comprobantes_factura)}`,
        `kpi,comprobantes_ticket,${csvEscape(payload.kpis.comprobantes_ticket)}`,
        `kpi,vendidos_comprobantes,${csvEscape(payload.kpis.vendidos_comprobantes)}`,
        `kpi,deuda_cta_cte,${csvEscape(payload.kpis.deuda_cta_cte)}`,
        `kpi,gasto_proveedores,${csvEscape(payload.kpis.gasto_proveedores)}`,
        'top_proveedores,nombre,gasto',
        ...payload.top_proveedores.map(
          (p) => `top_proveedores,${csvEscape(p.nombre)},${csvEscape(p.gasto)}`,
        ),
      ];
      return {
        csv: lines.join('\n'),
        filename: `reporte-resumen-${desde}-${hasta}.csv`,
      };
    }

    return { data: payload };
  }

  async getLibroIva(query: ReportPeriodQueryDto) {
    await this.assertFacturadorSimple();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const periodo = resolverPeriodoReporte(this.queryRecord(query));

    const rows = await this.fetchComprobantesEmitidos(
      tenantId,
      periodo.desde,
      periodo.hasta,
      sucursalId,
      {
        id: true,
        fecha: true,
        numero: true,
        tipo: true,
        subtotal: true,
        ivaMonto: true,
        ivaPorcentaje: true,
        total: true,
      },
    );

    const items = rows
      .filter((r) => esDocumentoIva(r.tipo))
      .map((r) => {
        const signo = esNotaCredito(r.tipo) ? -1 : 1;
        const neto = round2(Number(r.subtotal) * signo);
        const iva = round2(Number(r.ivaMonto) * signo);
        const total = round2(Number(r.total) * signo);
        return {
          id: r.id,
          fecha: r.fecha,
          numero: r.numero,
          tipo: r.tipo,
          alicuota: Number(r.ivaPorcentaje),
          neto,
          iva,
          total,
        };
      });

    const ivaNeto = round2(items.reduce((acc, it) => acc + it.iva, 0));
    const netoGravado = round2(items.reduce((acc, it) => acc + it.neto, 0));
    const totalComprobantes = round2(items.reduce((acc, it) => acc + it.total, 0));

    const porAlicuotaMap = new Map<number, { neto: number; iva: number; total: number }>();
    for (const it of items) {
      const prev = porAlicuotaMap.get(it.alicuota) ?? { neto: 0, iva: 0, total: 0 };
      porAlicuotaMap.set(it.alicuota, {
        neto: round2(prev.neto + it.neto),
        iva: round2(prev.iva + it.iva),
        total: round2(prev.total + it.total),
      });
    }
    const por_alicuota = Array.from(porAlicuotaMap.entries())
      .map(([alicuota, v]) => ({ alicuota, ...v }))
      .sort((a, b) => a.alicuota - b.alicuota);

    if ((query.export ?? '').toLowerCase() === 'csv') {
      const lines = [
        'fecha,tipo,numero,alicuota,neto,iva,total',
        ...items.map((it) =>
          [
            csvEscape(it.fecha),
            csvEscape(it.tipo),
            csvEscape(it.numero ?? ''),
            csvEscape(it.alicuota),
            csvEscape(it.neto),
            csvEscape(it.iva),
            csvEscape(it.total),
          ].join(','),
        ),
      ];
      return {
        csv: lines.join('\n'),
        filename: `reporte-libro-iva-${periodo.desde}-${periodo.hasta}.csv`,
      };
    }

    return {
      data: {
        sucursal_id: sucursalId,
        periodo: { key: periodo.key, desde: periodo.desde, hasta: periodo.hasta },
        resumen: {
          neto_gravado: netoGravado,
          iva_neto: ivaNeto,
          total_comprobantes: totalComprobantes,
          cantidad: items.length,
        },
        por_alicuota,
        items,
      },
    };
  }

  async getSalesPeriodSummary(query: ReportPeriodQueryDto, user: AccessTokenPayload) {
    await this.assertFacturadorSimple();
    this.assertAdmin(user);
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const { desde, hasta, periodo, label } = resolverPeriodoReporteConLabel(
      this.queryRecord(query),
      { defaultKey: 'hoy' },
    );

    const comprobantes = await this.fetchComprobantesEmitidos(tenantId, desde, hasta, sucursalId, {
      id: true,
      fecha: true,
      total: true,
      tipo: true,
      numeroOrden: true,
      subtotal: true,
      ivaMonto: true,
    });
    const costoRows = await this.fetchCostoItems(tenantId, desde, hasta, sucursalId);

    let ivaPeriodo = 0;
    for (const r of comprobantes) {
      if (!esDocumentoIva(r.tipo)) continue;
      const signo = esNotaCredito(r.tipo) ? -1 : 1;
      ivaPeriodo += Number(r.ivaMonto) * signo;
    }
    ivaPeriodo = round2(ivaPeriodo);

    let facturado = 0;
    let montoNotasCredito = 0;
    let vendidosComprobantes = 0;
    const aplastado = aplanarRepresentativosVentaPorOrden(
      comprobantes.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        numeroOrden: c.numeroOrden,
        total: Number(c.total),
      })),
    );

    for (const c of aplastado) {
      const tipo = c.tipo;
      const total = Number(c.total);
      if (excluidoDeAgregadoVentas(tipo)) continue;
      if (esNotaCredito(tipo)) {
        facturado -= total;
        montoNotasCredito += total;
        continue;
      }
      facturado += total;
      if (esComprobanteVenta(tipo)) vendidosComprobantes += 1;
    }

    let ventasNetas = 0;
    for (const c of aplastado) {
      const tipo = c.tipo;
      if (excluidoDeAgregadoVentas(tipo)) continue;
      const signed = esNotaCredito(tipo) ? -Number(c.total) : Number(c.total);
      if (!esVenta(tipo) && !esNotaCredito(tipo)) continue;
      ventasNetas += signed;
    }

    let costoMercaderia = 0;
    for (const row of costoRows) {
      const tipo = row.compTipo;
      if (!esVenta(tipo) && !esNotaCredito(tipo)) continue;
      const signed = esNotaCredito(tipo) ? -1 : 1;
      costoMercaderia += Number(row.precioCosto) * Number(row.cantidad) * signed;
    }

    const margenBruto = ventasNetas - costoMercaderia;

    return {
      data: {
        sucursal_id: sucursalId,
        periodo: { key: periodo, label, desde, hasta },
        resumen: {
          ventas: round2(facturado),
          devoluciones: round2(montoNotasCredito),
          costos: round2(costoMercaderia),
          iva: ivaPeriodo,
          ganancia: round2(margenBruto),
          facturas_emitidas: vendidosComprobantes,
        },
      },
    };
  }

  async getSalesByProduct(query: SalesByProductQueryDto) {
    await this.assertFacturadorSimple();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const periodo = resolverPeriodoReporte(this.queryRecord(query));
    const limit = Math.min(500, Math.max(1, query.limit ?? 200));

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
        'ci.precio_costo AS precio_costo',
        'ci.subtotal AS subtotal',
        'ci.producto_id AS producto_id',
        'c.id AS comprobante_id',
        'c.tipo AS tipo',
        'c.total AS comp_total',
        'c.sucursal_id AS sucursal_id',
        'p.id AS prod_id',
        'p.codigo AS codigo',
        'p.nombre AS nombre',
        'p.stock_actual AS stock_actual',
        'p.stock_minimo AS stock_minimo',
        'p.fecha_vencimiento AS fecha_vencimiento',
        'p.proveedor_id AS proveedor_id',
        'cat.nombre AS categoria_nombre',
        'prov.nombre AS proveedor_nombre',
      ]);

    if (sucursalId) qb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });
    if (query.categoriaId) qb.andWhere('p.categoria_id = :categoriaId', { categoriaId: query.categoriaId });
    if (query.proveedorId) qb.andWhere('p.proveedor_id = :proveedorId', { proveedorId: query.proveedorId });
    if (query.productoId) qb.andWhere('p.id = :productoId', { productoId: query.productoId });

    const rawRows = await qb.getRawMany<{
      cantidad: string;
      precio_costo: string | null;
      subtotal: string;
      producto_id: string;
      comprobante_id: string;
      tipo: string;
      comp_total: string;
      sucursal_id: string | null;
      prod_id: string;
      codigo: string;
      nombre: string;
      stock_actual: string;
      stock_minimo: string;
      fecha_vencimiento: string | null;
      categoria_nombre: string | null;
      proveedor_nombre: string | null;
      proveedor_id: string | null;
    }>();

    type Agg = {
      producto_id: string;
      codigo: string;
      nombre: string;
      categoria_nombre: string | null;
      proveedor_id: string | null;
      proveedor_nombre: string | null;
      unidades: number;
      importe_venta: number;
      costo_total: number;
      comprobantes: Set<string>;
      stock_actual: number;
      stock_minimo: number;
      fecha_vencimiento: string | null;
    };

    const filasParaFactor: { subtotal: number; compId: string; compTotal: number }[] = [];
    const filasIncluidas: {
      raw: (typeof rawRows)[0];
      tipo: string;
      compId: string;
      prodId: string;
    }[] = [];

    const incluirLinea = (tipo: string) =>
      !excluidoDeAgregadoVentas(tipo) && (esVenta(tipo) || esNotaCredito(tipo));

    for (const raw of rawRows) {
      const tipo = raw.tipo;
      if (!incluirLinea(tipo)) continue;
      if (sucursalId && raw.sucursal_id !== sucursalId) continue;

      filasParaFactor.push({
        subtotal: Number(raw.subtotal),
        compId: raw.comprobante_id,
        compTotal: Number(raw.comp_total),
      });

      filasIncluidas.push({ raw, tipo, compId: raw.comprobante_id, prodId: raw.prod_id });
    }

    const sumaLineasPorComp = new Map<string, number>();
    const totalPorComp = new Map<string, number>();
    for (const { subtotal, compId, compTotal } of filasParaFactor) {
      sumaLineasPorComp.set(compId, (sumaLineasPorComp.get(compId) ?? 0) + subtotal);
      totalPorComp.set(compId, compTotal);
    }
    const factorPorComp = new Map<string, number>();
    for (const [compId, sumaLineas] of sumaLineasPorComp) {
      factorPorComp.set(
        compId,
        factorLineasVsTotalComprobante(totalPorComp.get(compId) ?? sumaLineas, sumaLineas),
      );
    }

    const agg = new Map<string, Agg>();
    for (const { raw, tipo, compId, prodId } of filasIncluidas) {
      const sign = esNotaCredito(tipo) ? -1 : 1;
      const cant = Number(raw.cantidad) * sign;
      const factor = factorPorComp.get(compId) ?? 1;
      const subtotal = round2(Number(raw.subtotal) * factor) * sign;
      const costo = Number(raw.precio_costo ?? 0) * Number(raw.cantidad) * sign;

      const prev =
        agg.get(prodId) ??
        ({
          producto_id: prodId,
          codigo: raw.codigo,
          nombre: raw.nombre,
          categoria_nombre: raw.categoria_nombre,
          proveedor_id: raw.proveedor_id,
          proveedor_nombre: raw.proveedor_nombre,
          unidades: 0,
          importe_venta: 0,
          costo_total: 0,
          comprobantes: new Set<string>(),
          stock_actual: Number(raw.stock_actual),
          stock_minimo: Number(raw.stock_minimo),
          fecha_vencimiento: raw.fecha_vencimiento,
        } satisfies Agg);

      prev.unidades += cant;
      prev.importe_venta += subtotal;
      prev.costo_total += costo;
      prev.comprobantes.add(compId);
      agg.set(prodId, prev);
    }

    const productIds = Array.from(agg.keys());
    if (sucursalId && productIds.length > 0) {
      const stockRows = await this.stockSucursalRepo.find({
        where: { tenantId, sucursalId, productoId: In(productIds) },
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

    const totalImporte = Array.from(agg.values()).reduce((a, r) => a + r.importe_venta, 0);
    const totalUnidades = Array.from(agg.values()).reduce((a, r) => a + r.unidades, 0);
    const totalCosto = Array.from(agg.values()).reduce((a, r) => a + r.costo_total, 0);

    const [ultimasEntradas, comprasPorProducto] = await Promise.all([
      this.fetchUltimasEntradas(tenantId, productIds),
      this.fetchUnidadesCompradasPorProducto(tenantId, productIds, periodo.desde, periodo.hasta),
    ]);
    const totalUnidadesCompradas = Array.from(comprasPorProducto.values()).reduce((a, v) => a + v, 0);

    const filas = Array.from(agg.values())
      .map((r) => {
        const margen = r.importe_venta - r.costo_total;
        const margen_pct = r.importe_venta === 0 ? null : round2((margen / r.importe_venta) * 100);
        const participacion_pct =
          totalImporte === 0 ? 0 : round2((r.importe_venta / totalImporte) * 100);
        const quiebre = r.stock_minimo > 0 && r.stock_actual <= r.stock_minimo;
        const diasVenc = diasHastaVencimiento(r.fecha_vencimiento);
        const ue = ultimasEntradas.get(r.producto_id) ?? null;
        const uCompras = comprasPorProducto.get(r.producto_id) ?? 0;
        return {
          producto_id: r.producto_id,
          codigo: r.codigo,
          nombre: r.nombre,
          categoria: r.categoria_nombre,
          proveedor: r.proveedor_nombre,
          unidades: round2(r.unidades),
          unidades_compradas: round2(uCompras),
          importe_venta: round2(r.importe_venta),
          costo_total: round2(r.costo_total),
          margen: round2(margen),
          margen_pct,
          participacion_pct,
          tickets: r.comprobantes.size,
          stock_actual: r.stock_actual,
          stock_minimo: r.stock_minimo,
          quiebre,
          fecha_vencimiento: r.fecha_vencimiento,
          dias_hasta_vencimiento: diasVenc,
          estado_vencimiento: estadoVencimiento(diasVenc),
          ultima_entrada: ue
            ? {
                fecha: ue.createdAt.toISOString(),
                cantidad: ue.cantidad,
                motivo: ue.motivo,
                referencia_tipo: ue.referenciaTipo,
              }
            : null,
        };
      })
      .sort((a, b) => b.importe_venta - a.importe_venta)
      .slice(0, limit);

    const payload = {
      sucursal_id: sucursalId,
      periodo,
      filtros: {
        categoria_id: query.categoriaId ?? null,
        proveedor_id: query.proveedorId ?? null,
        producto_id: query.productoId ?? null,
        limit,
      },
      indicadores: {
        articulos_distintos: agg.size,
        total_unidades: round2(totalUnidades),
        total_unidades_compradas: round2(totalUnidadesCompradas),
        total_importe_venta: round2(totalImporte),
        total_costo: round2(totalCosto),
        margen_total: round2(totalImporte - totalCosto),
      },
      nota:
        'Unidades compradas: suma de movimientos de entrada con referencia factura, pedido o importaci├│n. ├Ültima entrada resume la ├║ltima entrada de stock.',
      filas,
    };

    if ((query.export ?? '').toLowerCase() === 'csv') {
      const header =
        'codigo,nombre,categoria,proveedor,unidades_vendidas,importe_venta,costo_total,margen,margen_pct,participacion_pct,tickets,stock_actual,stock_minimo,quiebre';
      const lines = [
        header,
        ...filas.map((it) =>
          [
            csvEscape(it.codigo),
            csvEscape(it.nombre),
            csvEscape(it.categoria ?? ''),
            csvEscape(it.proveedor ?? ''),
            csvEscape(it.unidades),
            csvEscape(it.importe_venta),
            csvEscape(it.costo_total),
            csvEscape(it.margen),
            csvEscape(it.margen_pct ?? ''),
            csvEscape(it.participacion_pct),
            csvEscape(it.tickets),
            csvEscape(it.stock_actual),
            csvEscape(it.stock_minimo),
            csvEscape(it.quiebre ? 'si' : 'no'),
          ].join(','),
        ),
      ];
      return {
        csv: lines.join('\n'),
        filename: `reporte-ventas-articulo-${periodo.desde}-${periodo.hasta}.csv`,
      };
    }

    return { data: payload };
  }

  async getPosConsumerSales(query: PosConsumerSalesQueryDto) {
    await this.assertFacturadorPos();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const periodo = resolverPeriodoReporte(this.queryRecord(query), { defaultKey: 'hoy' });
    const franja = query.franja === 'media_jornada' ? 'media_jornada' : 'hora';
    const cajaId = query.cajaId?.trim() || '';
    const usuarioId = query.usuarioId?.trim() || '';

    const qb = this.comprobanteRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.estado = :estado', { estado: EstadoComprobante.emitido })
      .andWhere('c.tipo = :tipo', { tipo: 'ticket' })
      .andWhere('c.fecha >= :desde', { desde: periodo.desde })
      .andWhere('c.fecha <= :hasta', { hasta: periodo.hasta })
      .orderBy('c.created_at', 'DESC');

    if (sucursalId) qb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });
    if (cajaId) qb.andWhere('c.caja_id = :cajaId', { cajaId });
    if (usuarioId) qb.andWhere('c.usuario_id = :usuarioId', { usuarioId });

    const tickets = await qb.getMany();
    const totalTickets = tickets.length;
    const totalVendido = round2(tickets.reduce((acc, t) => acc + Number(t.total), 0));
    const ticketPromedio = totalTickets > 0 ? round2(totalVendido / totalTickets) : 0;
    const ordenes = new Set(tickets.map((t) => t.numeroOrden)).size;

    const userIds = [...new Set(tickets.map((t) => t.usuarioId).filter(Boolean))] as string[];
    let usuarioMap = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await this.usuarioRepo.find({
        where: { tenantId, id: In(userIds) },
        select: { id: true, nombre: true, apellido: true },
      });
      usuarioMap = new Map(users.map((u) => [u.id, `${u.nombre} ${u.apellido}`.trim()]));
    }

    const cajas = [...new Set(tickets.map((t) => t.cajaId).filter(Boolean))].map((id) => ({
      id: id!,
      label: id!,
    }));
    const usuarios = Array.from(usuarioMap.entries()).map(([id, nombre]) => ({ id, nombre }));

    const dist = new Map<string, { label: string; tickets: number; total: number }>();
    for (const t of tickets) {
      const hour = horaArgentina(t.createdAt) ?? 0;
      const label =
        franja === 'hora'
          ? `${String(hour).padStart(2, '0')}:00`
          : hour < 12
            ? 'Ma├▒ana (00-11)'
            : 'Tarde/Noche (12-23)';
      const prev = dist.get(label) ?? { label, tickets: 0, total: 0 };
      prev.tickets += 1;
      prev.total += Number(t.total);
      dist.set(label, prev);
    }
    const distribucion = Array.from(dist.values())
      .map((it) => ({ ...it, total: round2(it.total) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const detalle = tickets.map((t) => ({
      id: t.id,
      numero: t.numero,
      numero_orden: t.numeroOrden,
      fecha: t.fecha,
      created_at: t.createdAt.toISOString(),
      total: Number(t.total),
      caja_id: t.cajaId,
      usuario_id: t.usuarioId,
      usuario_nombre: t.usuarioId ? (usuarioMap.get(t.usuarioId) ?? t.usuarioId) : null,
      metodo_pago: t.metodoPago,
    }));

    if ((query.export ?? '').toLowerCase() === 'csv') {
      const lines = [
        'fecha,numero_ticket,numero_orden,caja_id,usuario,metodo_pago,total',
        ...detalle.map((it) =>
          [
            csvEscape(it.fecha),
            csvEscape(it.numero ?? ''),
            csvEscape(it.numero_orden ?? ''),
            csvEscape(it.caja_id ?? ''),
            csvEscape(it.usuario_nombre ?? it.usuario_id ?? ''),
            csvEscape(it.metodo_pago ?? ''),
            csvEscape(round2(Number(it.total))),
          ].join(','),
        ),
      ];
      return {
        csv: lines.join('\n'),
        filename: `reporte-ventas-consumidor-${periodo.desde}-${periodo.hasta}.csv`,
      };
    }

    return {
      data: {
        sucursal_id: sucursalId,
        periodo,
        filtros: { caja_id: cajaId || null, usuario_id: usuarioId || null, franja },
        indicadores: {
          total_tickets: totalTickets,
          total_vendido: totalVendido,
          ticket_promedio: ticketPromedio,
          total_ordenes: ordenes,
        },
        distribucion,
        detalle,
        opciones: { cajas, usuarios },
      },
    };
  }

  private async fetchUnidadesCompradasPorProducto(
    tenantId: string,
    productoIds: string[],
    desde: string,
    hasta: string,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (productoIds.length === 0) return map;
    const desdeTs = new Date(inicioDiaArgentinaIsoUtc(desde));
    const hastaTs = new Date(finDiaArgentinaIsoUtc(hasta));
    const movs = await this.movimientoRepo.find({
      where: {
        tenantId,
        tipo: TipoMovimiento.entrada,
        referenciaTipo: In([ReferenciaTipo.factura, ReferenciaTipo.pedido, ReferenciaTipo.importacion]),
        productoId: In(productoIds),
        createdAt: Between(desdeTs, hastaTs),
      },
      select: { productoId: true, cantidad: true },
    });
    for (const m of movs) {
      const q = Number(m.cantidad);
      if (!Number.isFinite(q) || q <= 0) continue;
      map.set(m.productoId, (map.get(m.productoId) ?? 0) + q);
    }
    return map;
  }

  private async fetchUltimasEntradas(
    tenantId: string,
    productoIds: string[],
  ): Promise<
    Map<
      string,
      { createdAt: Date; cantidad: number; motivo: string | null; referenciaTipo: ReferenciaTipo | null }
    >
  > {
    const map = new Map<
      string,
      { createdAt: Date; cantidad: number; motivo: string | null; referenciaTipo: ReferenciaTipo | null }
    >();
    if (productoIds.length === 0) return map;
    const movs = await this.movimientoRepo.find({
      where: { tenantId, tipo: TipoMovimiento.entrada, productoId: In(productoIds) },
      select: { productoId: true, createdAt: true, cantidad: true, motivo: true, referenciaTipo: true },
      order: { createdAt: 'DESC' },
    });
    for (const m of movs) {
      if (map.has(m.productoId)) continue;
      map.set(m.productoId, {
        createdAt: m.createdAt,
        cantidad: Number(m.cantidad),
        motivo: m.motivo,
        referenciaTipo: m.referenciaTipo,
      });
    }
    return map;
  }

  private async fetchComprobantesEmitidos(
    tenantId: string,
    desde: string,
    hasta: string,
    sucursalId: string | null,
    select: FindOptionsSelect<Comprobante>,
  ): Promise<Comprobante[]> {
    return this.comprobanteRepo.find({
      where: {
        tenantId,
        estado: EstadoComprobante.emitido,
        fecha: Between(desde, hasta),
        ...(sucursalId ? { sucursalId } : {}),
      },
      select,
    });
  }

  private async fetchCostoItems(tenantId: string, desde: string, hasta: string, sucursalId: string | null) {
    const qb = this.compItemRepo
      .createQueryBuilder('ci')
      .innerJoin(Comprobante, 'c', 'c.id = ci.comprobante_id')
      .innerJoin(Producto, 'p', 'p.id = ci.producto_id')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.estado = :estado', { estado: EstadoComprobante.emitido })
      .andWhere('c.fecha >= :desde', { desde })
      .andWhere('c.fecha <= :hasta', { hasta })
      .select([
        'ci.cantidad AS cantidad',
        'ci.precio_costo AS precio_costo',
        'c.tipo AS comp_tipo',
        'p.proveedor_id AS proveedor_id',
      ]);
    if (sucursalId) qb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });
    const rows = await qb.getRawMany<{
      cantidad: string;
      precio_costo: string | null;
      comp_tipo: string;
      proveedor_id: string | null;
    }>();
    return rows.map((r) => ({
      cantidad: r.cantidad,
      precioCosto: r.precio_costo ?? '0',
      compTipo: r.comp_tipo,
      proveedorId: r.proveedor_id,
    }));
  }

  private aggregateGastoProveedor(
    rows: { cantidad: string; precioCosto: string; compTipo: string; proveedorId: string | null }[],
  ): Map<string, number> {
    const gastoPorProveedor = new Map<string, number>();
    for (const it of rows) {
      if (!it.proveedorId) continue;
      const tipo = it.compTipo;
      if (!esComprobanteVenta(tipo) && !esNotaCredito(tipo)) continue;
      const costo = Number(it.precioCosto) * Number(it.cantidad);
      const signed = esNotaCredito(tipo) ? -costo : costo;
      gastoPorProveedor.set(it.proveedorId, (gastoPorProveedor.get(it.proveedorId) ?? 0) + signed);
    }
    return gastoPorProveedor;
  }

  private queryRecord(
    query: ReportPeriodQueryDto | SalesByProductQueryDto | PosConsumerSalesQueryDto,
  ): Record<string, string | undefined> {
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

  private async assertFacturadorPos(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.facturadorPos) {
      throw new ForbiddenException('Este reporte requiere el m├│dulo facturador_pos habilitado.');
    }
  }

  private assertAdmin(user: AccessTokenPayload): void {
    const role = resolveAppRole(user);
    if (role !== 'admin') {
      throw new ForbiddenException('Solo el administrador puede ver este reporte.');
    }
  }
}
