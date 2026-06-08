import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { FacturaImportadaAplicacion } from '../facturacion/entities/factura-importada-aplicacion.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { numeroComprobanteImportado } from '../facturacion/utils/numero-comprobante-importado';
import { ReferenciaTipo } from '../inventory/enums/referencia-tipo.enum';
import { TipoMovimiento } from '../inventory/enums/tipo-movimiento.enum';
import { REGISTRAR_MOVIMIENTO_SQL } from '../inventory/sql/registrar-movimiento.sql';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { PagoProveedorFactura } from '../importaciones/entities/pago-proveedor-factura.entity';
import {
  calcularSaldoPendienteNuevoCargo,
  calcularVencimientoDia,
  proveedorTieneCondicionPagoCargada,
  vencimientoTimestamptzDesdeDia,
} from '../importaciones/utils/pago-proveedor-vencimiento.util';
import { ProductoLoteIngreso } from '../products/entities/producto-lote-ingreso.entity';
import { Producto } from '../products/entities/producto.entity';
import { LoteIngresoOrigen } from '../products/enums/lote-ingreso-origen.enum';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import {
  calcularPrecioVenta,
  IVA_DEFAULT_PCT,
} from '../products/utils/calcular-precio-venta';
import { registrarLoteIngreso } from '../products/utils/registrar-lote-ingreso';
import { LectorFacturaLog } from './entities/lector-factura-log.entity';
import {
  calcularImportesComprobante,
  importesPreferiendoTotalInformado,
  type ImportesComprobante,
} from './utils/calcular-importes-comprobante.util';
import type {
  ActualizacionCostoProducto,
  ConfirmarImportadoBody,
} from './utils/confirmar-importado.util';
import {
  comprobanteActualizaIvaProducto,
  esTipoNotaCredito,
  preciosItemsConIvaIncluidoAplican,
  resuelvePagoProveedorEfectivo,
} from './utils/confirmar-importado.util';
import {
  incrementarSaldoCuentaCliente,
  incrementarSaldoCuentaProveedor,
} from './utils/cuenta-corriente-increment.util';
import {
  decidirNuevoCosto,
  esCodigoAutoGeneradoDesdeFactura,
} from './utils/decidir-nuevo-costo.util';
import {
  findProveedorPorCuitNorm,
  findProveedorPorNombreSimilar,
  normCuit,
} from './utils/factura-direccion.util';
import {
  mapUnidadFacturaTexto,
  normalizarLineaLectorFactura,
} from './utils/normalizar-linea-lector-factura.util';

const TOLERANCIA_COSTO = 0.005;
const UMBRAL_BONIFICACION = 0.000001;

type ItemResuelto = {
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  precio_costo: number;
  aplico_inferencia_pack?: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function costoPrevioValido(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return n > UMBRAL_BONIFICACION ? n : null;
}

function esLineaBonificacionOReposicion(item: Pick<ItemResuelto, 'precio_unitario'>): boolean {
  return Number(item.precio_unitario) <= UMBRAL_BONIFICACION;
}

function totalPercepcionesFactura(body: Pick<
  ConfirmarImportadoBody,
  'percepcion_iibb_monto' | 'percepcion_iva_monto' | 'impuesto_interno_monto'
>): number {
  return round2(
    Math.max(0, body.percepcion_iibb_monto) +
      Math.max(0, body.percepcion_iva_monto) +
      Math.max(0, body.impuesto_interno_monto),
  );
}

function importesDesdeCabeceraManual(
  body: ConfirmarImportadoBody,
  base: ImportesComprobante,
): ImportesComprobante {
  const subtotal = round2(Math.max(0, body.subtotal));
  const iva_monto = round2(Math.max(0, body.iva_monto));
  const total = round2(Math.max(0, body.total));
  const iva_porcentaje =
    subtotal > 0 && iva_monto > 0 ? round2((iva_monto * 100) / subtotal) : base.iva_porcentaje;
  return { ...base, subtotal, iva_monto, iva_porcentaje, total };
}

function importesConPercepciones(importes: ImportesComprobante, percepciones: number): ImportesComprobante {
  const monto = round2(Math.max(0, percepciones));
  if (monto <= 0) return importes;
  return { ...importes, total: round2(importes.total + monto) };
}

function construirActualizacionCostoProducto(args: {
  producto_id: string;
  codigo: string | null;
  nombre: string | null;
  precio_costo_anterior: number | null;
  precio_costo_nuevo: number;
  precio_venta_anterior: number | null;
}): ActualizacionCostoProducto | null {
  const anterior = costoPrevioValido(args.precio_costo_anterior);
  const nuevo = Number(args.precio_costo_nuevo);
  if (!Number.isFinite(nuevo)) return null;
  if (anterior != null && Math.abs(anterior - nuevo) <= TOLERANCIA_COSTO) return null;
  const variacionPct =
    anterior != null && anterior > 0 ? round2(((nuevo - anterior) / anterior) * 100) : null;
  return {
    producto_id: args.producto_id,
    codigo: args.codigo,
    nombre: args.nombre?.trim() || 'Producto sin nombre',
    precio_costo_anterior: anterior,
    precio_costo_nuevo: nuevo,
    precio_venta_anterior: args.precio_venta_anterior,
    precio_venta_nuevo: args.precio_venta_anterior,
    variacion_pct: variacionPct,
  };
}

function unidadCatalogoDesdeLineaFactura(
  unidad_factura: string | null,
  aplico_inferencia_pack: boolean | undefined,
): UnidadMedida {
  const u = mapUnidadFacturaTexto(unidad_factura);
  if (aplico_inferencia_pack && (u === UnidadMedida.caja || u === UnidadMedida.pack)) {
    return UnidadMedida.unidad;
  }
  return u;
}

@Injectable()
export class LectorConfirmacionImportadoService {
  private readonly logger = new Logger(LectorConfirmacionImportadoService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(LectorFacturaLog) private readonly logRepo: Repository<LectorFacturaLog>,
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal) private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(CuentaCorriente) private readonly cuentaRepo: Repository<CuentaCorriente>,
    @InjectRepository(PagoProveedorFactura)
    private readonly pagoProveedorFacturaRepo: Repository<PagoProveedorFactura>,
  ) {}

  async ejecutar(params: {
    tenantId: string;
    sucursalId: string;
    userId: string;
    body: ConfirmarImportadoBody;
    origen: 'lector' | 'manual';
  }): Promise<{
    comprobante_id: string;
    actualizaciones_costos: ActualizacionCostoProducto[];
    pdf_url: string | null;
  }> {
    const { tenantId, sucursalId, userId, body, origen } = params;

    if (body.log_id) {
      const logRow = await this.logRepo.findOne({ where: { id: body.log_id, tenantId } });
      if (!logRow) throw new NotFoundException('Extracción no encontrada');
      if (logRow.estado !== 'extraido') {
        throw new ConflictException('Esta extracción ya fue confirmada o no está disponible');
      }
    }

    let proveedorId = body.proveedor_id;
    let clienteId = body.cliente_id;

    if (body.crear_proveedor) {
      const existentes = await this.proveedorRepo.find({
        where: { tenantId, activo: true },
        select: ['id', 'cuit', 'nombre'],
      });
      const match =
        findProveedorPorCuitNorm(existentes, normCuit(body.crear_proveedor.cuit)) ??
        findProveedorPorNombreSimilar(existentes, body.crear_proveedor.razon_social);
      if (match) {
        proveedorId = match.id;
      } else {
        const saved = await this.proveedorRepo.save(
          this.proveedorRepo.create({
            tenantId,
            nombre: body.crear_proveedor.razon_social,
            cuit: body.crear_proveedor.cuit,
            activo: true,
          }),
        );
        proveedorId = saved.id;
      }
    }

    if (body.crear_cliente) {
      const saved = await this.clienteRepo.save(
        this.clienteRepo.create({
          tenantId,
          nombre: body.crear_cliente.razon_social,
          razonSocial: body.crear_cliente.razon_social,
          cuitDni: body.crear_cliente.cuit_dni,
          activo: true,
        }),
      );
      clienteId = saved.id;
    }

    if (body.tipo_operacion === 'compra' && !proveedorId) {
      throw new BadRequestException('Factura de compra: indicá o creá un proveedor');
    }
    if (body.tipo_operacion === 'venta' && !clienteId) {
      throw new BadRequestException('Factura de venta: indicá o creá un cliente');
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const ivaDefault = tenant?.ivaPorcentajeDefault != null
      ? Number(tenant.ivaPorcentajeDefault)
      : IVA_DEFAULT_PCT;

    const sucursal = await this.sucursalRepo.findOne({ where: { id: sucursalId, tenantId } });
    const businessPrefsTenant = (tenant?.businessPrefs ?? {}) as Record<string, unknown>;
    const businessPrefsSucursal = (sucursal?.businessPrefs ?? {}) as Record<string, unknown>;
    const precioCostoSoloSube =
      businessPrefsSucursal.precioCostoSoloSube === true ||
      businessPrefsTenant.precioCostoSoloSube === true;
    const registrarLotes =
      businessPrefsSucursal.registrarLotesPorIngreso === true ||
      businessPrefsTenant.registrarLotesPorIngreso === true;

    const inferirPack = origen === 'lector' && body.inferir_presentacion_compra_desde_nombre === true;
    const preciosIvaIncl =
      origen === 'lector' &&
      preciosItemsConIvaIncluidoAplican(
        body.tipo_comprobante,
        body.precios_items_con_iva_incluido === true,
      );
    const sincronizaIvaProducto = comprobanteActualizaIvaProducto(body.tipo_comprobante);

    const resolvedItems = await this.resolveItems({
      tenantId,
      sucursalId,
      proveedorId,
      body,
      origen,
      ivaDefault,
      inferirPack,
      preciosIvaIncl,
      sincronizaIvaProducto,
    });

    const productoIds = [...new Set(resolvedItems.map((i) => i.producto_id))];
    const productos = await this.productoRepo.find({
      where: { tenantId, id: In(productoIds) },
    });
    if (productos.length !== productoIds.length) {
      throw new BadRequestException('Uno o más productos no existen');
    }
    const prodMap = new Map(productos.map((p) => [p.id, p]));

    const itemsCalc = resolvedItems.map((it) => ({
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      iva_porcentaje: prodMap.get(it.producto_id)?.ivaPorcentaje != null
        ? Number(prodMap.get(it.producto_id)!.ivaPorcentaje)
        : ivaDefault,
    }));

    const precioNetoEnLineas =
      body.tipo_operacion === 'compra' &&
      (origen === 'manual' || body.precios_items_con_iva_incluido !== true);
    const importesCalculados = calcularImportesComprobante(
      itemsCalc,
      body.tipo_comprobante,
      ivaDefault,
      precioNetoEnLineas,
    );
    const percepcionesTotal = totalPercepcionesFactura(body);
    const totalPreferidoSinPercepciones =
      body.total != null ? round2(Math.max(0, body.total - percepcionesTotal)) : null;
    const usarImportesCabecera = body.importes_manuales === true;
    const importesBase = usarImportesCabecera
      ? importesDesdeCabeceraManual(body, importesCalculados)
      : importesPreferiendoTotalInformado(importesCalculados, totalPreferidoSinPercepciones);
    const importes = usarImportesCabecera
      ? importesBase
      : importesConPercepciones(importesBase, percepcionesTotal);

    await this.assertNoDuplicado(tenantId, body, proveedorId, clienteId);

    const actualizacionesCostos: ActualizacionCostoProducto[] = [];
    const comprobanteId = await this.dataSource.transaction(async (manager) => {
      const ordenRows = (await manager.query(
        `SELECT COALESCE(MAX(numero_orden), 0) + 1 AS n FROM comprobante WHERE tenant_id = $1`,
        [tenantId],
      )) as Array<{ n?: number | string }>;
      const numeroOrden = Number(ordenRows[0]?.n);
      const numero = numeroComprobanteImportado(body.punto_venta, body.numero_documento);
      const notas = this.buildNotas(body, origen);

      const comprobante = manager.create(Comprobante, {
        tenantId,
        sucursalId,
        usuarioId: userId,
        clienteId: body.tipo_operacion === 'venta' ? clienteId : null,
        proveedorId: body.tipo_operacion === 'compra' ? proveedorId : null,
        tipo: body.tipo_comprobante as TipoComprobante,
        tipoOperacion: body.tipo_operacion,
        estado: EstadoComprobante.importado,
        fecha: body.fecha.slice(0, 10),
        numero,
        numeroOrden: Number.isFinite(numeroOrden) ? numeroOrden : null,
        subtotal: importes.subtotal.toFixed(2),
        ivaPorcentaje: importes.iva_porcentaje.toFixed(2),
        ivaMonto: importes.iva_monto.toFixed(2),
        total: importes.total.toFixed(2),
        cae: body.cae,
        caeVencimiento: body.cae_vencimiento?.slice(0, 10) ?? null,
        notas,
        pdfUrl: null,
      });
      const saved = await manager.save(Comprobante, comprobante);

      for (const it of resolvedItems) {
        const sub = round2(it.cantidad * it.precio_unitario);
        await manager.save(
          ComprobanteItem,
          manager.create(ComprobanteItem, {
            comprobanteId: saved.id,
            productoId: it.producto_id,
            cantidad: it.cantidad.toFixed(3),
            precioUnitario: it.precio_unitario.toFixed(2),
            precioCosto: it.precio_costo.toFixed(6),
            subtotal: sub.toFixed(2),
          }),
        );
      }

      if (body.afecta_stock) {
        await this.aplicarStock({
          manager,
          tenantId,
          sucursalId,
          userId,
          body,
          origen,
          proveedorId,
          comprobanteId: saved.id,
          resolvedItems,
          registrarLotes,
        });
      }

      if (body.afecta_cuenta_corriente && importes.total > 0) {
        await this.aplicarCuentaCorriente({
          manager,
          tenantId,
          userId,
          body,
          proveedorId,
          clienteId,
          comprobanteId: saved.id,
          importesTotal: importes.total,
        });
      }

      const aplicaActualizacionCostos =
        body.actualizar_costos &&
        body.tipo_operacion === 'compra' &&
        !esTipoNotaCredito(body.tipo_comprobante);

      if (aplicaActualizacionCostos) {
        for (const it of resolvedItems) {
          if (esLineaBonificacionOReposicion(it)) continue;
          const prod = prodMap.get(it.producto_id);
          if (!prod) continue;
          const anterior = costoPrevioValido(Number(prod.precioCosto));
          const decidido = decidirNuevoCosto(precioCostoSoloSube, anterior, it.precio_costo);
          const nuevo = decidido ?? anterior;
          if (nuevo == null) continue;
          const ventaAnt = Number(prod.precioVenta);
          const actualizacion = construirActualizacionCostoProducto({
            producto_id: it.producto_id,
            codigo: prod.codigo,
            nombre: prod.nombre,
            precio_costo_anterior: anterior,
            precio_costo_nuevo: nuevo,
            precio_venta_anterior: ventaAnt,
          });
          if (!actualizacion) continue;
          await manager.update(Producto, { id: prod.id, tenantId }, { precioCosto: nuevo.toFixed(2) });
          actualizacionesCostos.push(actualizacion);
          prodMap.set(it.producto_id, { ...prod, precioCosto: nuevo.toFixed(2) });
        }
      }

      if (body.tipo_operacion === 'compra') {
        const signoDeltaCC = esTipoNotaCredito(body.tipo_comprobante) ? -1 : 1;
        const cuentaCorrienteDelta =
          body.afecta_cuenta_corriente && proveedorId && importes.total > 0
            ? signoDeltaCC * importes.total
            : 0;
        await manager.save(
          FacturaImportadaAplicacion,
          manager.create(FacturaImportadaAplicacion, {
            tenantId,
            comprobanteId: saved.id,
            origen,
            afectaStock: body.afecta_stock,
            afectaCuentaCorriente: body.afecta_cuenta_corriente,
            subtotal: importes.subtotal.toFixed(6),
            ivaMonto: importes.iva_monto.toFixed(6),
            total: importes.total.toFixed(6),
            cuentaCorrienteDelta: cuentaCorrienteDelta.toFixed(6),
            estado: 'aplicada',
          }),
        );
      }

      return saved.id;
    });

    if (body.log_id) {
      await this.logRepo.update(
        { id: body.log_id, tenantId },
        {
          estado: 'confirmado',
          comprobanteId,
          proveedorId: proveedorId ?? null,
          clienteId: clienteId ?? null,
        },
      );
    }

    return {
      comprobante_id: comprobanteId,
      actualizaciones_costos: actualizacionesCostos,
      pdf_url: null,
    };
  }

  private async resolveItems(params: {
    tenantId: string;
    sucursalId: string;
    proveedorId: string | null;
    body: ConfirmarImportadoBody;
    origen: 'lector' | 'manual';
    ivaDefault: number;
    inferirPack: boolean;
    preciosIvaIncl: boolean;
    sincronizaIvaProducto: boolean;
  }): Promise<ItemResuelto[]> {
    const {
      tenantId,
      sucursalId,
      proveedorId,
      body,
      origen,
      ivaDefault,
      inferirPack,
      preciosIvaIncl,
      sincronizaIvaProducto,
    } = params;

    const resolved: ItemResuelto[] = [];
    let autoCodigoSeq = 0;
    const prefijoCodigoAuto = origen === 'manual' ? 'CMP' : 'LFA';

    for (const it of body.items) {
      if (it.producto_id) {
        const prod = await this.productoRepo.findOne({
          where: { id: it.producto_id, tenantId, activo: true },
        });
        if (!prod) throw new BadRequestException(`Producto no encontrado: ${it.producto_id}`);
        const norm = normalizarLineaLectorFactura({
          descripcion_factura: it.descripcion_factura ?? '',
          nombre_producto_catalogo: prod.nombre,
          unidad_factura: it.unidad_factura,
          unidad_stock_producto: prod.unidad,
          cantidad: it.cantidad,
          precio_unitario: it.precio_unitario,
          precio_costo_input: it.precio_costo,
          inferir_pack: inferirPack,
          presentacion_modo: it.presentacion_modo ?? 'auto',
          contenido_presentacion_compra: it.contenido_presentacion_compra ?? null,
          precios_con_iva_incluido: preciosIvaIncl,
          iva_porcentaje: it.iva_porcentaje,
          iva_default: ivaDefault,
        });
        resolved.push({
          producto_id: prod.id,
          cantidad: norm.cantidad,
          precio_unitario: norm.precio_unitario,
          precio_costo: norm.precio_costo,
          aplico_inferencia_pack: norm.aplico_inferencia_pack,
        });
        continue;
      }

      if (body.tipo_operacion !== 'compra' || !it.crear_desde_factura) {
        throw new BadRequestException('Ítem inválido');
      }

      const codigoDesdeFactura = it.crear_desde_factura.codigo?.trim() ?? '';
      if (
        origen === 'lector' &&
        codigoDesdeFactura &&
        !esCodigoAutoGeneradoDesdeFactura(codigoDesdeFactura)
      ) {
        const existente = await this.productoRepo.findOne({
          where: { tenantId, codigo: codigoDesdeFactura, activo: true },
        });
        if (existente) {
          const norm = normalizarLineaLectorFactura({
            descripcion_factura: it.descripcion_factura ?? it.crear_desde_factura.nombre,
            nombre_producto_catalogo: existente.nombre,
            unidad_factura: it.unidad_factura,
            unidad_stock_producto: existente.unidad,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            precio_costo_input: it.precio_costo,
            inferir_pack: inferirPack,
            presentacion_modo: it.presentacion_modo ?? 'auto',
            contenido_presentacion_compra: it.contenido_presentacion_compra ?? null,
            precios_con_iva_incluido: preciosIvaIncl,
            iva_porcentaje: it.iva_porcentaje,
            iva_default: ivaDefault,
          });
          resolved.push({
            producto_id: existente.id,
            cantidad: norm.cantidad,
            precio_unitario: norm.precio_unitario,
            precio_costo: norm.precio_costo,
            aplico_inferencia_pack: norm.aplico_inferencia_pack,
          });
          continue;
        }
      }

      let codigo = codigoDesdeFactura;
      if (!codigo) codigo = `${prefijoCodigoAuto}-${Date.now()}-${autoCodigoSeq++}`;

      const norm = normalizarLineaLectorFactura({
        descripcion_factura: it.descripcion_factura ?? it.crear_desde_factura.nombre,
        nombre_producto_catalogo: null,
        unidad_factura: it.unidad_factura,
        unidad_stock_producto: mapUnidadFacturaTexto(it.unidad_factura),
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        precio_costo_input: it.precio_costo,
        inferir_pack: inferirPack,
        presentacion_modo: it.presentacion_modo ?? 'auto',
        contenido_presentacion_compra: it.contenido_presentacion_compra ?? null,
        precios_con_iva_incluido: preciosIvaIncl,
        iva_porcentaje: it.iva_porcentaje,
        iva_default: ivaDefault,
      });

      const ivaP = it.iva_porcentaje ?? ivaDefault;
      const ivaProductoNuevo = sincronizaIvaProducto ? ivaP : null;
      const costo = norm.precio_costo;
      const precioVenta = calcularPrecioVenta(costo, 0, ivaProductoNuevo, ivaDefault);

      let unidadProd = mapUnidadFacturaTexto(it.unidad_factura);
      if (norm.aplico_inferencia_pack && (unidadProd === UnidadMedida.caja || unidadProd === UnidadMedida.pack)) {
        unidadProd = UnidadMedida.unidad;
      }

      const entity = this.productoRepo.create({
        tenantId,
        sucursalId,
        codigo,
        nombre: it.crear_desde_factura.nombre.slice(0, 500),
        proveedorId,
        unidad: unidadProd,
        precioCosto: costo.toFixed(2),
        precioVenta: precioVenta.toFixed(2),
        stockActual: '0.000',
        stockMinimo: '0.000',
        ivaPorcentaje: ivaProductoNuevo != null ? ivaProductoNuevo.toFixed(2) : null,
        activo: true,
      });
      const saved = await this.productoRepo.save(entity);
      resolved.push({
        producto_id: saved.id,
        cantidad: norm.cantidad,
        precio_unitario: norm.precio_unitario,
        precio_costo: norm.precio_costo,
        aplico_inferencia_pack: norm.aplico_inferencia_pack,
      });
    }

    return resolved;
  }

  private async aplicarStock(params: {
    manager: import('typeorm').EntityManager;
    tenantId: string;
    sucursalId: string;
    userId: string;
    body: ConfirmarImportadoBody;
    origen: 'lector' | 'manual';
    proveedorId: string | null;
    comprobanteId: string;
    resolvedItems: ItemResuelto[];
    registrarLotes: boolean;
  }) {
    const { manager, tenantId, sucursalId, userId, body, origen, proveedorId, comprobanteId, resolvedItems, registrarLotes } =
      params;
    const esNotaCredito = esTipoNotaCredito(body.tipo_comprobante);
    const esEntrada = esNotaCredito ? body.tipo_operacion === 'venta' : body.tipo_operacion === 'compra';
    const refTipo = esEntrada ? ReferenciaTipo.factura_recibida : ReferenciaTipo.factura_importada;
    const tipoMov = esEntrada ? TipoMovimiento.entrada : TipoMovimiento.salida;
    const sufijo = origen === 'manual' ? 'manual' : 'IA';
    const motivo = esEntrada
      ? esNotaCredito
        ? `Entrada por NC emitida (${sufijo})`
        : `Entrada por factura recibida (${sufijo})`
      : esNotaCredito
        ? `Salida por NC recibida (${sufijo})`
        : `Salida por factura importada (${sufijo})`;

    const loteRepo = manager.getRepository(ProductoLoteIngreso);

    for (const it of resolvedItems) {
      const movRows = (await manager.query(REGISTRAR_MOVIMIENTO_SQL, [
        tenantId,
        it.producto_id,
        sucursalId,
        tipoMov,
        it.cantidad,
        motivo,
        refTipo,
        comprobanteId,
        userId,
        esEntrada && !esNotaCredito ? proveedorId : null,
      ])) as Array<{ id?: string }>;
      const movimientoId = movRows[0]?.id ?? null;

      if (esEntrada && registrarLotes && !esNotaCredito) {
        await registrarLoteIngreso(loteRepo, {
          tenantId,
          productoId: it.producto_id,
          sucursalId,
          proveedorId,
          cantidad: it.cantidad,
          fechaVencimiento: null,
          precioCosto: it.precio_costo,
          origen: LoteIngresoOrigen.lector_facturas,
          lectorFacturaLogId: body.log_id,
          movimientoId,
          creadoPor: userId,
        });
      }
    }
  }

  private async aplicarCuentaCorriente(params: {
    manager: import('typeorm').EntityManager;
    tenantId: string;
    userId: string;
    body: ConfirmarImportadoBody;
    proveedorId: string | null;
    clienteId: string | null;
    comprobanteId: string;
    importesTotal: number;
  }) {
    const { manager, tenantId, userId, body, proveedorId, clienteId, comprobanteId, importesTotal } =
      params;
    const esNotaCreditoCC = esTipoNotaCredito(body.tipo_comprobante);
    const deltaSaldo = esNotaCreditoCC ? -importesTotal : importesTotal;
    const cuentaRepo = manager.getRepository(CuentaCorriente);
    const pagoRepo = manager.getRepository(PagoProveedorFactura);

    if (body.tipo_operacion === 'compra' && proveedorId) {
      const saldoCuenta = await incrementarSaldoCuentaProveedor(
        cuentaRepo,
        tenantId,
        proveedorId,
        deltaSaldo,
      );

      const trackearOblProveedor =
        body.direccion === 'recibida' &&
        body.tipo_operacion === 'compra' &&
        proveedorId &&
        !esNotaCreditoCC;

      if (trackearOblProveedor) {
        const prov = await this.proveedorRepo.findOne({ where: { id: proveedorId, tenantId } });
        const pagoE = resuelvePagoProveedorEfectivo(body, prov
          ? {
              condicion_pago_default: prov.condicionPagoDefault,
              plazo_pago_dias: prov.plazoPagoDias,
            }
          : null);
        const provCond = prov
          ? { condicionPagoDefault: prov.condicionPagoDefault, plazoPagoDias: prov.plazoPagoDias }
          : null;
        if (
          pagoE.estado === 'pendiente_condicion' &&
          !proveedorTieneCondicionPagoCargada(provCond)
        ) {
          throw new BadRequestException(
            'Cargá la condición de pago en la ficha del proveedor o elegí “fecha personalizada”.',
          );
        }

        const { vencimientoDiaYmd, condicion } = calcularVencimientoDia({
          estado: pagoE.estado,
          fechaFacturaYmd: body.fecha.slice(0, 10),
          proveedor: provCond,
          vencimientoCustomYmd:
            pagoE.estado === 'pendiente_fecha_custom' ? pagoE.vencimiento_at : null,
          fechaPagoYmd: pagoE.estado === 'ya_pagada' ? pagoE.fecha_pago : null,
        });
        const vencAt = vencimientoTimestamptzDesdeDia(vencimientoDiaYmd);
        const saldoPendienteInicial = calcularSaldoPendienteNuevoCargo(
          saldoCuenta.saldoNuevo,
          importesTotal,
        );
        const estadoInicial =
          saldoPendienteInicial <= 0
            ? 'pagada'
            : saldoPendienteInicial < importesTotal - 0.01
              ? 'parcial'
              : 'pendiente';

        const ppIns = await pagoRepo.save(
          pagoRepo.create({
            tenantId,
            comprobanteId,
            proveedorId,
            montoOriginal: importesTotal.toFixed(6),
            saldoPendiente: saldoPendienteInicial.toFixed(6),
            vencimientoAt: vencAt,
            condicionPago: condicion,
            estado: estadoInicial,
            origen: 'comprobante',
          }),
        );

        if (pagoE.estado === 'ya_pagada') {
          const tipoP = pagoE.tipo_pago;
          if (!tipoP) throw new BadRequestException('Falta el medio de pago');
          await manager.query(
            `SELECT public.registrar_pago_proveedor_obligacion(
              $1::uuid, $2::uuid, $3::numeric, $4::public.tipo_pago, $5::text, $6::uuid, $7::date
            )`,
            [tenantId, ppIns.id, importesTotal, tipoP, null, userId, pagoE.fecha_pago],
          );
        }
      }
    } else if (body.tipo_operacion === 'venta' && clienteId) {
      await incrementarSaldoCuentaCliente(cuentaRepo, tenantId, clienteId, deltaSaldo);
    }
  }

  private async assertNoDuplicado(
    tenantId: string,
    body: ConfirmarImportadoBody,
    proveedorId: string | null,
    clienteId: string | null,
  ) {
    const numero = numeroComprobanteImportado(body.punto_venta, body.numero_documento);
    if (numero == null) return;

    const where: Record<string, unknown> = {
      tenantId,
      estado: EstadoComprobante.importado,
      tipoOperacion: body.tipo_operacion,
      tipo: body.tipo_comprobante,
      numero,
    };
    if (body.tipo_operacion === 'compra' && proveedorId) where.proveedorId = proveedorId;
    if (body.tipo_operacion === 'venta' && clienteId) where.clienteId = clienteId;

    const dup = await this.comprobanteRepo.findOne({ where: where as never });
    if (dup) {
      throw new ConflictException(
        'Ya existe un comprobante importado con el mismo proveedor/cliente y numeración',
      );
    }
  }

  private buildNotas(body: ConfirmarImportadoBody, origen: 'lector' | 'manual'): string {
    const tag = origen === 'manual' ? 'manual' : 'lector';
    let notas = `[${tag}] pv=${body.punto_venta ?? '-'} n=${body.numero_documento ?? '-'}`;
    if (
      body.percepcion_iibb_monto > 0 ||
      body.percepcion_iva_monto > 0 ||
      body.impuesto_interno_monto > 0
    ) {
      notas += ` · perc_iibb=${body.percepcion_iibb_monto} perc_iva=${body.percepcion_iva_monto} imp_int=${body.impuesto_interno_monto}`;
    }
    if (body.observaciones?.trim()) {
      notas += ` · ${body.observaciones.trim().slice(0, 500)}`;
    }
    return notas;
  }
}
