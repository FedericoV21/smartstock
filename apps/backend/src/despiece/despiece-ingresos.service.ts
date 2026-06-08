import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ReferenciaTipo } from '../inventory/enums/referencia-tipo.enum';
import { TipoMovimiento } from '../inventory/enums/tipo-movimiento.enum';
import { REGISTRAR_MOVIMIENTO_SQL } from '../inventory/sql/registrar-movimiento.sql';
import { LectorConfirmacionImportadoService } from '../lector-facturas/lector-confirmacion-importado.service';
import { calcularImportesComprobante } from '../lector-facturas/utils/calcular-importes-comprobante.util';
import type { ConfirmarImportadoBody } from '../lector-facturas/utils/confirmar-importado.util';
import { ProductoLoteIngreso } from '../products/entities/producto-lote-ingreso.entity';
import { Producto } from '../products/entities/producto.entity';
import { LoteIngresoOrigen } from '../products/enums/lote-ingreso-origen.enum';
import { registrarLoteIngreso } from '../products/utils/registrar-lote-ingreso';
import { DespieceBaseService } from './despiece-base.service';
import { DespieceCorte } from './entities/despiece-corte.entity';
import { DespiecePlantilla } from './entities/despiece-plantilla.entity';
import {
  costoCatalogoDesdePrecioVentaDespiece,
  resolverPesoIngresoKgDesdePayload,
  type PlantillaConRelaciones,
} from './utils/despiece-api.util';
import { upsertPrecioSucursalDespiece } from './utils/despiece-catalogo.util';
import { IVA_DESPIECE } from './utils/constantes';
import { recalcularPreciosSucursalConGanancia } from './utils/despiece-precio-sucursal.util';
import { calcular4Estrategias } from './utils/motor';
import { serializePlantilla } from './utils/despiece-serialize.util';
import type { DespieceEstrategia } from './utils/tipos';

const TIPOS_COMPRA_PADRE = new Set(['factura_a', 'factura_b', 'factura_c', 'remito']);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function readRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function isYmd(value: string | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function readOptionalDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizarNombreCorte(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

type CorteIngreso = {
  producto_id: string;
  nombre: string;
  cantidad: number;
  factor_ajuste_pct: number;
  precio_anclado: number | null;
};

@Injectable()
export class DespieceIngresosService {
  constructor(
    @InjectRepository(DespiecePlantilla) private readonly plantillaRepo: Repository<DespiecePlantilla>,
    @InjectRepository(DespieceCorte) private readonly corteRepo: Repository<DespieceCorte>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(ProductoLoteIngreso) private readonly loteRepo: Repository<ProductoLoteIngreso>,
    @InjectRepository(PrecioSucursal) private readonly precioRepo: Repository<PrecioSucursal>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal) private readonly sucursalRepo: Repository<Sucursal>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly base: DespieceBaseService,
    private readonly confirmacionImportado: LectorConfirmacionImportadoService,
  ) {}

  private async loadPlantillaForIngreso(plantillaId: string): Promise<PlantillaConRelaciones> {
    const tenantId = this.base.getTenantId();
    const plantilla = await this.plantillaRepo.findOne({ where: { id: plantillaId, tenantId } });
    if (!plantilla) throw new NotFoundException('Plantilla no encontrada.');

    const cortes = await this.corteRepo.find({
      where: { plantillaId, tenantId },
      order: { orden: 'ASC' },
    });
    const padre = plantilla.productoPadreId
      ? await this.productoRepo.findOne({ where: { id: plantilla.productoPadreId, tenantId } })
      : null;
    const hijoIds = cortes.map((c) => c.productoHijoId);
    const hijos =
      hijoIds.length > 0
        ? await this.productoRepo.find({ where: { tenantId, id: In(hijoIds) } })
        : [];
    const hijosMap = new Map(hijos.map((h) => [h.id, h]));

    return serializePlantilla(
      plantilla,
      padre,
      cortes.map((corte) => ({ corte, productoHijo: hijosMap.get(corte.productoHijoId) ?? null })),
    ) as unknown as PlantillaConRelaciones;
  }

  async registrar(body: unknown, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoEditar(user);

    const b = readRecord(body);
    const plantillaId = typeof b.plantilla_id === 'string' ? b.plantilla_id : '';
    const costoKgPadre = Number(b.costo_kg);
    const aplicarPrecios = b.aplicar_precios === true;
    const preview = b.preview === true;
    const estrategia = String(b.estrategia ?? 'fija') as DespieceEstrategia;

    if (!plantillaId) throw new BadRequestException('Seleccioná una plantilla.');
    if (!Number.isFinite(costoKgPadre) || costoKgPadre <= 0) {
      throw new BadRequestException('El costo por kg debe ser mayor a 0.');
    }
    if (aplicarPrecios && !['variable', 'fija', 'anclada'].includes(estrategia)) {
      throw new BadRequestException('Estrategia inválida.');
    }

    const preciosEditados = new Map<string, number | null>();
    const preciosEditadosRaw = Array.isArray(b.precios_editados) ? b.precios_editados : [];
    for (const item of preciosEditadosRaw) {
      const row = readRecord(item);
      const productoId = typeof row.producto_id === 'string' ? row.producto_id : '';
      if (!productoId) continue;
      const precio =
        row.precio_venta == null || row.precio_venta === '' ? null : Number(row.precio_venta);
      if (precio != null && (!Number.isFinite(precio) || precio < 0)) {
        throw new BadRequestException('Los precios editados deben ser mayores o iguales a 0.');
      }
      preciosEditados.set(productoId, precio);
    }

    if (aplicarPrecios || [...preciosEditados.values()].some((p) => p != null)) {
      await this.base.assertPermisoAplicarPrecios(user);
    }

    const sucursalId = await this.base.resolveSucursalId(
      typeof b.sucursal_id === 'string' ? b.sucursal_id : null,
    );

    const plantilla = await this.loadPlantillaForIngreso(plantillaId);
    const cortes = (plantilla.cortes ?? []).slice().sort((a, b) => a.orden - b.orden);
    if (cortes.length === 0) {
      throw new BadRequestException('La plantilla no tiene cortes.');
    }

    const kgPlantilla = Number(plantilla.peso_total_kg);
    if (!(kgPlantilla > 0)) {
      throw new BadRequestException('La plantilla no tiene peso base valido.');
    }

    let pesoIngresadoKg: number;
    try {
      pesoIngresadoKg = round3(resolverPesoIngresoKgDesdePayload(plantilla, body).pesoKg);
    } catch (pesoError) {
      throw new BadRequestException(
        pesoError instanceof Error ? pesoError.message : 'El peso ingresado debe ser mayor a 0.',
      );
    }

    const mermaKgRaw = b.merma_kg;
    const mermaPctRaw = b.merma_pct;
    const tieneMermaKg = mermaKgRaw !== undefined && mermaKgRaw !== null && mermaKgRaw !== '';
    const tieneMermaPct = mermaPctRaw !== undefined && mermaPctRaw !== null && mermaPctRaw !== '';

    let kgVendiblesObjetivo: number | null = null;
    if (tieneMermaKg) {
      const mermaKgManual = Number(mermaKgRaw);
      if (!Number.isFinite(mermaKgManual) || mermaKgManual < 0) {
        throw new BadRequestException('La merma en kg debe ser mayor o igual a 0.');
      }
      if (mermaKgManual >= pesoIngresadoKg) {
        throw new BadRequestException('La merma en kg debe ser menor al peso ingresado.');
      }
      kgVendiblesObjetivo = round3(pesoIngresadoKg - mermaKgManual);
    } else if (tieneMermaPct) {
      const mermaPctManual = Number(mermaPctRaw);
      if (!Number.isFinite(mermaPctManual) || mermaPctManual < 0) {
        throw new BadRequestException('La merma % debe ser mayor o igual a 0.');
      }
      if (mermaPctManual >= 100) {
        throw new BadRequestException('La merma % debe ser menor a 100.');
      }
      kgVendiblesObjetivo = round3(pesoIngresadoKg * (1 - mermaPctManual / 100));
    }

    const factor = pesoIngresadoKg / kgPlantilla;
    const kgRendidosPlantilla = cortes.reduce((acc, c) => acc + Number(c.kg_rendimiento), 0);
    if (!(kgRendidosPlantilla > 0)) {
      throw new BadRequestException('La plantilla no tiene kg rendibles.');
    }

    const kgRealPorNombre = new Map<string, number>();
    const kgRealPorProducto = new Map<string, number>();
    for (const item of Array.isArray(b.cortes_reales) ? b.cortes_reales : []) {
      const row = readRecord(item);
      const productoId = typeof row.producto_id === 'string' ? row.producto_id.trim() : '';
      const nombre = typeof row.nombre === 'string' ? row.nombre : '';
      const keyNombre = normalizarNombreCorte(nombre);
      if (!productoId && !keyNombre) continue;
      const kgRaw = row.kg_ingresado ?? row.cantidad;
      const kg = kgRaw == null || kgRaw === '' ? 0 : Number(kgRaw);
      if (!Number.isFinite(kg) || kg < 0) {
        throw new BadRequestException('Los kg reales por corte deben ser mayores o iguales a 0.');
      }
      if (keyNombre) kgRealPorNombre.set(keyNombre, round3(kg));
      if (productoId) kgRealPorProducto.set(productoId, round3(kg));
    }

    const cortesIngresoPorNombre = new Map<string, CorteIngreso>();
    for (const corte of cortes) {
      const productoId = corte.producto_hijo_id;
      const nombre = corte.nombre_en_plantilla || corte.producto_hijo?.nombre || productoId;
      const keyNombre = normalizarNombreCorte(nombre);
      const participacionVendible = Number(corte.kg_rendimiento) / kgRendidosPlantilla;
      let cantidad =
        kgVendiblesObjetivo == null
          ? round3(Number(corte.kg_rendimiento) * factor)
          : round3(kgVendiblesObjetivo * participacionVendible);
      if (kgRealPorNombre.has(keyNombre)) cantidad = kgRealPorNombre.get(keyNombre)!;
      else if (kgRealPorProducto.has(productoId)) cantidad = kgRealPorProducto.get(productoId)!;

      if (cortesIngresoPorNombre.has(keyNombre)) cortesIngresoPorNombre.delete(keyNombre);
      cortesIngresoPorNombre.set(keyNombre, {
        producto_id: productoId,
        nombre,
        cantidad,
        factor_ajuste_pct: Number(corte.factor_ajuste_pct ?? 0),
        precio_anclado: corte.precio_anclado == null ? null : Number(corte.precio_anclado),
      });
    }

    const cortesIngreso = [...cortesIngresoPorNombre.values()];
    const kgVendiblesIngreso = round3(cortesIngreso.reduce((acc, c) => acc + c.cantidad, 0));
    if (!(kgVendiblesIngreso > 0)) {
      throw new BadRequestException('La suma de kg reales por corte debe ser mayor a 0.');
    }
    if (kgVendiblesIngreso - pesoIngresadoKg > 0.01) {
      throw new BadRequestException(
        'Los kg vendibles no pueden superar el peso ingresado de la media res.',
      );
    }

    const costoTotalIngreso = round2(costoKgPadre * pesoIngresadoKg);
    const costoEfectivoKgCorte = round2(costoTotalIngreso / kgVendiblesIngreso);
    const mermaKg = round3(pesoIngresadoKg - kgVendiblesIngreso);
    const mermaPct = round2((mermaKg / pesoIngresadoKg) * 100);
    const rendimientoPct = round2((kgVendiblesIngreso / pesoIngresadoKg) * 100);

    const resultado = calcular4Estrategias({
      nombre: plantilla.nombre,
      costoKgPadre,
      pesoTotalKg: pesoIngresadoKg,
      rentabilidadObjetivoPct: Number(plantilla.rentabilidad_objetivo_pct ?? 0),
      cortes: cortesIngreso.map((corte) => ({
        id: corte.producto_id,
        nombre: corte.nombre,
        kgRendimiento: corte.cantidad,
        factorAjustePct: corte.factor_ajuste_pct,
        precioAnclado: corte.precio_anclado,
      })),
    });

    const precioPorProducto = new Map(
      resultado.cortes.map((corte) => {
        const precio =
          estrategia === 'variable'
            ? corte.variable.precioKg
            : estrategia === 'fija'
              ? corte.fija.precioKg
              : corte.anclada.precioKg;
        return [String(corte.id), precio == null ? null : round2(precio)] as const;
      }),
    );

    const previewMovimientos = cortesIngreso.map((corte) => {
      const precioCalculado = aplicarPrecios ? precioPorProducto.get(corte.producto_id) ?? null : null;
      const precioVentaNuevo = preciosEditados.has(corte.producto_id)
        ? preciosEditados.get(corte.producto_id)!
        : precioCalculado;
      return {
        producto_id: corte.producto_id,
        nombre: corte.nombre,
        cantidad: corte.cantidad,
        movimiento_id: null,
        precio_venta_nuevo: precioVentaNuevo,
      };
    });

    if (preview) {
      return {
        preview: true,
        plantilla_id: plantillaId,
        sucursal_id: sucursalId,
        peso_ingresado_kg: pesoIngresadoKg,
        costo_kg: costoKgPadre,
        costo_efectivo_kg_corte: costoEfectivoKgCorte,
        kg_vendibles: kgVendiblesIngreso,
        merma_kg: mermaKg,
        merma_pct: mermaPct,
        rendimiento_pct: rendimientoPct,
        movimientos: previewMovimientos,
        resultado,
      };
    }

    const proveedorId =
      typeof b.proveedor_id === 'string' && b.proveedor_id.trim() ? b.proveedor_id.trim() : null;
    const fechaVencimiento =
      typeof b.fecha_vencimiento === 'string' && b.fecha_vencimiento.trim()
        ? b.fecha_vencimiento.trim()
        : null;
    const registrarFacturaCompra = b.registrar_factura_compra === true;
    const registrarIngresoPadre = b.registrar_ingreso_padre === true || registrarFacturaCompra;

    if (registrarIngresoPadre || registrarFacturaCompra) {
      if (!plantilla.producto_padre_id) {
        throw new BadRequestException(
          'La plantilla necesita un producto padre para registrar el ingreso.',
        );
      }
      if (!proveedorId) {
        throw new BadRequestException('Selecciona un proveedor para registrar el ingreso del padre.');
      }
    }

    const tipoComprobanteCompra =
      typeof b.tipo_comprobante_compra === 'string' && b.tipo_comprobante_compra.trim()
        ? b.tipo_comprobante_compra.trim()
        : 'factura_c';
    const fechaCompra = readOptionalDate(b.fecha_compra);
    const fechaVencimientoCompra = readOptionalDate(b.fecha_vencimiento_compra);
    const puntoVentaCompra = readOptionalNumber(b.punto_venta_compra);
    const numeroDocumentoCompra = readOptionalNumber(b.numero_documento_compra);
    const observacionesCompra =
      typeof b.observaciones_compra === 'string' && b.observaciones_compra.trim()
        ? b.observaciones_compra.trim()
        : null;

    if (registrarFacturaCompra) {
      if (!TIPOS_COMPRA_PADRE.has(tipoComprobanteCompra)) {
        throw new BadRequestException('Tipo de comprobante de compra invalido.');
      }
      if (!isYmd(fechaCompra)) {
        throw new BadRequestException('La fecha de compra es obligatoria.');
      }
      if (fechaVencimientoCompra != null && !isYmd(fechaVencimientoCompra)) {
        throw new BadRequestException('La fecha de vencimiento de compra es invalida.');
      }
      if (
        puntoVentaCompra == null ||
        numeroDocumentoCompra == null ||
        puntoVentaCompra <= 0 ||
        numeroDocumentoCompra <= 0
      ) {
        throw new BadRequestException(
          'Ingresa punto de venta y numero de comprobante para la factura de compra.',
        );
      }
    }

    const tenantId = this.base.getTenantId();
    const userId = user.sub;
    let comprobanteCompraId: string | null = null;
    let movimientoPadre: {
      producto_id: string;
      nombre: string;
      cantidad: number;
      movimiento_id: string | null;
      comprobante_id: string | null;
    } | null = null;

    if (plantilla.producto_padre_id) {
      await this.productoRepo.update(
        { id: plantilla.producto_padre_id, tenantId },
        {
          precioCosto: costoKgPadre.toFixed(2),
          esDespiecePadre: true,
          ivaPorcentaje: IVA_DESPIECE.toFixed(2),
          ...(proveedorId && (registrarIngresoPadre || registrarFacturaCompra)
            ? { proveedorId }
            : {}),
        },
      );
      await recalcularPreciosSucursalConGanancia({
        productoRepo: this.productoRepo,
        precioRepo: this.precioRepo,
        tenantRepo: this.tenantRepo,
        sucursalRepo: this.sucursalRepo,
        tenantId,
        productoId: plantilla.producto_padre_id,
      });
    }

    if (
      registrarFacturaCompra &&
      plantilla.producto_padre_id &&
      proveedorId &&
      fechaCompra
    ) {
      const importesCompra = calcularImportesComprobante(
        [
          {
            producto_id: plantilla.producto_padre_id,
            cantidad: pesoIngresadoKg,
            precio_unitario: costoKgPadre,
            iva_porcentaje: IVA_DESPIECE,
          },
        ],
        tipoComprobanteCompra,
        IVA_DESPIECE,
        true,
      );
      const compraBody: ConfirmarImportadoBody = {
        log_id: null,
        direccion: 'recibida',
        proveedor_id: proveedorId,
        cliente_id: null,
        crear_proveedor: null,
        crear_cliente: null,
        tipo_comprobante: tipoComprobanteCompra,
        tipo_operacion: 'compra',
        fecha: fechaCompra,
        punto_venta: puntoVentaCompra,
        numero_documento: numeroDocumentoCompra,
        cae: null,
        cae_vencimiento: null,
        items: [
          {
            producto_id: plantilla.producto_padre_id,
            crear_desde_factura: null,
            cantidad: pesoIngresadoKg,
            precio_unitario: costoKgPadre,
            precio_costo: costoKgPadre,
            iva_porcentaje: IVA_DESPIECE,
            unidad_factura: 'kg',
            descripcion_factura: plantilla.producto_padre?.nombre ?? plantilla.nombre,
            codigo_factura: null,
          },
        ],
        subtotal: importesCompra.subtotal,
        iva_monto: importesCompra.iva_monto,
        percepcion_iibb_monto: 0,
        percepcion_iva_monto: 0,
        impuesto_interno_monto: 0,
        total: importesCompra.total,
        actualizar_costos: false,
        afecta_stock: false,
        afecta_cuenta_corriente: true,
        observaciones:
          observacionesCompra ??
          `Compra registrada desde despiece: ${plantilla.nombre}`.slice(0, 500),
        fecha_vencimiento_sugerida: fechaVencimientoCompra ?? fechaCompra,
        pago: fechaVencimientoCompra
          ? { estado: 'pendiente_fecha_custom', vencimiento_at: fechaVencimientoCompra }
          : null,
        importes_manuales: false,
      };

      const compraResult = await this.confirmacionImportado.ejecutar({
        tenantId,
        sucursalId,
        userId,
        body: compraBody,
        origen: 'manual',
      });
      comprobanteCompraId = compraResult.comprobante_id;
    }

    if (registrarIngresoPadre && plantilla.producto_padre_id && proveedorId) {
      const movRows = (await this.dataSource.query(REGISTRAR_MOVIMIENTO_SQL, [
        tenantId,
        plantilla.producto_padre_id,
        sucursalId,
        TipoMovimiento.entrada,
        pesoIngresadoKg,
        `Ingreso pieza padre por despiece: ${plantilla.nombre}`,
        comprobanteCompraId ? ReferenciaTipo.factura_recibida : ReferenciaTipo.manual,
        comprobanteCompraId,
        userId,
      ])) as Array<{ id: string }>;
      const movimientoPadreId = movRows[0]?.id ?? null;

      await registrarLoteIngreso(this.loteRepo, {
        tenantId,
        productoId: plantilla.producto_padre_id,
        sucursalId,
        proveedorId,
        cantidad: pesoIngresadoKg,
        fechaVencimiento,
        precioCosto: costoKgPadre,
        origen: LoteIngresoOrigen.manual,
        movimientoId: movimientoPadreId,
        creadoPor: userId,
      });

      movimientoPadre = {
        producto_id: plantilla.producto_padre_id,
        nombre: plantilla.producto_padre?.nombre ?? plantilla.nombre,
        cantidad: pesoIngresadoKg,
        movimiento_id: movimientoPadreId,
        comprobante_id: comprobanteCompraId,
      };
    }

    const movimientos: Array<{
      producto_id: string;
      nombre: string;
      cantidad: number;
      movimiento_id: string | null;
      precio_venta_nuevo: number | null;
    }> = [];

    for (const corte of cortesIngreso) {
      const productoId = corte.producto_id;
      const cantidad = corte.cantidad;
      if (!(cantidad > 0)) continue;

      const precioCalculado = aplicarPrecios ? precioPorProducto.get(productoId) ?? null : null;
      const precioVentaNuevo = preciosEditados.has(productoId)
        ? preciosEditados.get(productoId)!
        : precioCalculado;

      const precioCostoNuevo =
        precioVentaNuevo != null
          ? costoCatalogoDesdePrecioVentaDespiece(
              precioVentaNuevo,
              Number(plantilla.rentabilidad_objetivo_pct ?? 0),
            )
          : costoEfectivoKgCorte;

      const update: Partial<Producto> = {
        precioCosto: precioCostoNuevo.toFixed(2),
        ivaPorcentaje: IVA_DESPIECE.toFixed(2),
      };
      if (precioVentaNuevo != null) update.precioVenta = precioVentaNuevo.toFixed(2);
      await this.productoRepo.update({ id: productoId, tenantId }, update);

      if (precioVentaNuevo != null) {
        await upsertPrecioSucursalDespiece(this.precioRepo, {
          tenantId,
          productoId,
          sucursalId,
          precioCosto: precioCostoNuevo,
          precioVenta: precioVentaNuevo,
        });
      }

      await recalcularPreciosSucursalConGanancia({
        productoRepo: this.productoRepo,
        precioRepo: this.precioRepo,
        tenantRepo: this.tenantRepo,
        sucursalRepo: this.sucursalRepo,
        tenantId,
        productoId,
      });

      const movRows = (await this.dataSource.query(REGISTRAR_MOVIMIENTO_SQL, [
        tenantId,
        productoId,
        sucursalId,
        TipoMovimiento.entrada,
        cantidad,
        `Ingreso por despiece: ${plantilla.nombre}`,
        ReferenciaTipo.manual,
        null,
        userId,
      ])) as Array<{ id: string }>;
      const movimientoId = movRows[0]?.id ?? null;

      await registrarLoteIngreso(this.loteRepo, {
        tenantId,
        productoId,
        sucursalId,
        proveedorId,
        cantidad,
        fechaVencimiento,
        precioCosto: costoEfectivoKgCorte,
        origen: LoteIngresoOrigen.manual,
        movimientoId,
        creadoPor: userId,
      });

      movimientos.push({
        producto_id: productoId,
        nombre: corte.nombre,
        cantidad,
        movimiento_id: movimientoId,
        precio_venta_nuevo: precioVentaNuevo,
      });
    }

    return {
      plantilla_id: plantillaId,
      sucursal_id: sucursalId,
      peso_ingresado_kg: pesoIngresadoKg,
      costo_kg: costoKgPadre,
      costo_efectivo_kg_corte: costoEfectivoKgCorte,
      kg_vendibles: kgVendiblesIngreso,
      merma_kg: mermaKg,
      merma_pct: mermaPct,
      rendimiento_pct: rendimientoPct,
      movimiento_padre: movimientoPadre,
      comprobante_compra_id: comprobanteCompraId,
      movimientos,
      resultado,
    };
  }
}
