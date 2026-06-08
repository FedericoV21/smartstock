import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from '../config/entities/tenant.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { numeroComprobanteImportado } from '../facturacion/utils/numero-comprobante-importado';
import { LectorFacturaJob } from './entities/lector-factura-job.entity';
import { LectorConfirmacionImportadoService } from './lector-confirmacion-importado.service';
import type { LectorFacturaPreviewPayload } from './lector-facturas-extract.service';
import {
  calcularImportesComprobante,
  importesPreferiendoTotalInformado,
} from './utils/calcular-importes-comprobante.util';
import type {
  ActualizacionCostoProducto,
  ConfirmarImportadoBody,
  ItemConfirmarImportadoIn,
} from './utils/confirmar-importado.util';
import {
  TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO,
  esTipoNotaCredito,
  parsePagoProveedorField,
  validarItemsConfirmarImportado,
} from './utils/confirmar-importado.util';

export type LectorFacturaConfirmacionOverrides = {
  actualizar_costos?: boolean;
  afecta_stock?: boolean;
  afecta_cuenta_corriente?: boolean;
  precios_items_con_iva_incluido?: boolean;
  pago?: ConfirmarImportadoBody['pago'];
};

export type LectorFacturaImpacto = {
  resumen: Record<string, unknown>;
  cambios_costos: ActualizacionCostoProducto[];
  advertencias: string[];
  conflictos: string[];
  bloqueantes: string[];
  requiere_confirmacion: boolean;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

export function hashImpactoLectorFactura(impacto: LectorFacturaImpacto): string {
  return createHash('sha256').update(stableJson(impacto)).digest('hex');
}

@Injectable()
export class LectorConfirmacionChatbotService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(LectorFacturaJob) private readonly jobRepo: Repository<LectorFacturaJob>,
    private readonly confirmacion: LectorConfirmacionImportadoService,
  ) {}

  extractPreview(raw: unknown): LectorFacturaPreviewPayload | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    if (!obj.log_id || !Array.isArray(obj.items) || !obj.cabecera) return null;
    return obj as unknown as LectorFacturaPreviewPayload;
  }

  async prepararDesdeResultado(params: {
    tenantId: string;
    sucursalId: string | null;
    resultado: unknown;
    overrides?: LectorFacturaConfirmacionOverrides;
  }) {
    const preview = this.extractPreview(params.resultado);
    if (!preview) throw new Error('Resultado de job sin preview valido.');

    const tipoComprobante = this.normalizeTipoComprobante(
      preview.cabecera.tipo_comprobante,
      preview.cabecera.letra,
    );
    const preciosItemsConIvaIncluido =
      typeof params.overrides?.precios_items_con_iva_incluido === 'boolean'
        ? params.overrides.precios_items_con_iva_incluido
        : tipoComprobante === 'factura_b';

    const items = preview.items.map((item) => this.itemDesdePreview(item));
    const tenant = await this.tenantRepo.findOne({ where: { id: params.tenantId } });
    const ivaDefault = Number(tenant?.ivaPorcentajeDefault ?? preview.iva_default ?? 21);

    const confirmPayload: ConfirmarImportadoBody = {
      log_id: preview.log_id,
      direccion: preview.direccion ?? 'recibida',
      proveedor_id: preview.proveedor?.id ?? null,
      cliente_id: preview.cliente?.id ?? null,
      crear_proveedor: preview.crear_proveedor,
      crear_cliente: preview.crear_cliente,
      tipo_comprobante: tipoComprobante,
      tipo_operacion: preview.direccion === 'emitida' ? 'venta' : 'compra',
      fecha: (preview.cabecera.fecha_emision ?? new Date().toISOString()).slice(0, 10),
      punto_venta: preview.cabecera.punto_venta,
      numero_documento: preview.cabecera.numero,
      cae: preview.cabecera.cae,
      cae_vencimiento: preview.cabecera.cae_vencimiento?.slice(0, 10) ?? null,
      items,
      subtotal: 0,
      iva_monto: 0,
      percepcion_iibb_monto: 0,
      percepcion_iva_monto: 0,
      impuesto_interno_monto: 0,
      total: 0,
      actualizar_costos:
        params.overrides?.actualizar_costos ?? !esTipoNotaCredito(tipoComprobante),
      afecta_stock: params.overrides?.afecta_stock ?? true,
      afecta_cuenta_corriente: params.overrides?.afecta_cuenta_corriente ?? true,
      observaciones: preview.observaciones ?? null,
      fecha_vencimiento_sugerida: preview.cabecera.fecha_vencimiento?.slice(0, 10) ?? null,
      pago: params.overrides && 'pago' in params.overrides ? params.overrides.pago ?? null : null,
      precios_items_con_iva_incluido: preciosItemsConIvaIncluido,
    };

    const importes = this.calcularImportesPreview(confirmPayload, preview, ivaDefault, preciosItemsConIvaIncluido);
    Object.assign(confirmPayload, importes);

    const bloqueantes: string[] = [];
    const conflictos: string[] = [];
    const advertencias = [...(preview.validacion?.advertencias ?? [])];

    if (!TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO.has(confirmPayload.tipo_comprobante)) {
      bloqueantes.push(`Tipo de comprobante no confirmable: ${confirmPayload.tipo_comprobante}`);
    }
    const itemsErr = validarItemsConfirmarImportado(confirmPayload);
    if (itemsErr) bloqueantes.push(itemsErr);
    if (!params.sucursalId) bloqueantes.push('No hay sucursal operativa asociada al job.');
    if (await this.existeDuplicado(params.tenantId, confirmPayload)) {
      bloqueantes.push('Ya existe un comprobante importado con el mismo proveedor/cliente y numeracion.');
    }

    const impacto: LectorFacturaImpacto = {
      resumen: {
        proveedor_nombre: preview.proveedor?.nombre ?? preview.crear_proveedor?.razon_social ?? null,
        total_items: preview.items.length,
        total: confirmPayload.total,
        afecta_stock: confirmPayload.afecta_stock,
        afecta_cuenta_corriente: confirmPayload.afecta_cuenta_corriente,
        actualizar_costos: confirmPayload.actualizar_costos,
      },
      cambios_costos: [],
      advertencias,
      conflictos,
      bloqueantes,
      requiere_confirmacion: true,
    };

    return {
      confirmPayload,
      impacto,
      impactHash: hashImpactoLectorFactura(impacto),
    };
  }

  async aplicarJob(params: {
    tenantId: string;
    job: LectorFacturaJob;
    sucursalId: string;
    userId: string;
    acceptedImpactHash: string;
    overrides?: LectorFacturaConfirmacionOverrides;
  }) {
    if (params.job.appliedComprobanteId || params.job.applicationStatus === 'applied') {
      return {
        comprobante_id: String(params.job.appliedComprobanteId),
        actualizaciones_costos: [] as ActualizacionCostoProducto[],
        impacto: null as LectorFacturaImpacto | null,
        impact_hash: params.job.impactHash ?? '',
        idempotent_replay: true,
      };
    }

    const prepared = await this.prepararDesdeResultado({
      tenantId: params.tenantId,
      sucursalId: params.sucursalId,
      resultado: params.job.resultado,
      overrides: params.overrides,
    });

    if (prepared.impacto.bloqueantes.length > 0) {
      await this.jobRepo.update(params.job.id, {
        applicationStatus: 'blocked',
        impactoPreview: prepared.impacto as never,
        impactHash: prepared.impactHash,
        confirmPayload: prepared.confirmPayload as never,
        appliedError: prepared.impacto.bloqueantes.join(' | '),
      });
      throw new Error('La factura tiene bloqueantes antes de cargar.');
    }

    if (params.acceptedImpactHash !== prepared.impactHash) {
      throw new Error('Confirmacion requerida con accepted_impact_hash vigente.');
    }

    await this.jobRepo.update(params.job.id, {
      applicationStatus: 'applying',
      impactoPreview: prepared.impacto as never,
      impactHash: prepared.impactHash,
      confirmPayload: prepared.confirmPayload as never,
      appliedError: null,
    });

    try {
      const result = await this.confirmacion.ejecutar({
        tenantId: params.tenantId,
        sucursalId: params.sucursalId,
        userId: params.userId,
        body: prepared.confirmPayload,
        origen: 'lector',
      });

      await this.jobRepo.update(params.job.id, {
        applicationStatus: 'applied',
        appliedComprobanteId: result.comprobante_id,
        appliedAt: new Date(),
        appliedError: null,
      });

      return {
        comprobante_id: result.comprobante_id,
        actualizaciones_costos: result.actualizaciones_costos,
        impacto: prepared.impacto,
        impact_hash: prepared.impactHash,
        idempotent_replay: false,
      };
    } catch (e) {
      await this.jobRepo.update(params.job.id, {
        applicationStatus: 'error',
        appliedError: (e as Error).message.slice(0, 2000),
      });
      throw e;
    }
  }

  parseOverrides(raw: Record<string, unknown>): LectorFacturaConfirmacionOverrides {
    const overrides: LectorFacturaConfirmacionOverrides = {};
    if (typeof raw.actualizar_costos === 'boolean') overrides.actualizar_costos = raw.actualizar_costos;
    if (typeof raw.afecta_stock === 'boolean') overrides.afecta_stock = raw.afecta_stock;
    if (typeof raw.afecta_cuenta_corriente === 'boolean') {
      overrides.afecta_cuenta_corriente = raw.afecta_cuenta_corriente;
    }
    if (typeof raw.precios_items_con_iva_incluido === 'boolean') {
      overrides.precios_items_con_iva_incluido = raw.precios_items_con_iva_incluido;
    }
    if ('pago' in raw) {
      overrides.pago = parsePagoProveedorField(raw.pago);
    }
    return overrides;
  }

  private normalizeTipoComprobante(tipo: string | null | undefined, letra: string | null | undefined): string {
    const t = String(tipo ?? '').trim().toLowerCase();
    if (TIPOS_PERMITIDOS_CONFIRMAR_IMPORTADO.has(t)) return t;
    const l = String(letra ?? '').trim().toLowerCase();
    if ((t === 'factura' || t === 'fac') && (l === 'a' || l === 'b' || l === 'c')) return `factura_${l}`;
    if (
      (t === 'nota_credito' || t === 'nota de credito') &&
      (l === 'a' || l === 'b' || l === 'c')
    ) {
      return `nota_credito_${l}`;
    }
    return t || 'desconocido';
  }

  private itemDesdePreview(item: LectorFacturaPreviewPayload['items'][number]): ItemConfirmarImportadoIn {
    const productoId = item.match?.producto_id ?? null;
    const descripcion = item.descripcion?.trim() || 'Item factura';
    return {
      producto_id: productoId,
      crear_desde_factura: productoId ? null : { nombre: descripcion, codigo: item.codigo },
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precio_unitario),
      precio_costo: Number(item.precio_unitario),
      iva_porcentaje: Number.isFinite(Number(item.iva_porcentaje)) ? Number(item.iva_porcentaje) : null,
      unidad_factura: item.unidad,
      descripcion_factura: descripcion,
      codigo_factura: item.codigo,
      presentacion_modo: 'auto',
    };
  }

  private calcularImportesPreview(
    body: ConfirmarImportadoBody,
    preview: LectorFacturaPreviewPayload,
    ivaDefault: number,
    preciosItemsConIvaIncluido: boolean,
  ) {
    const lineas = body.items.map((item) => ({
      producto_id: item.producto_id ?? '_',
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      iva_porcentaje: item.iva_porcentaje ?? ivaDefault,
    }));
    const precioNetoEnLineas = body.tipo_operacion === 'compra' && !preciosItemsConIvaIncluido;
    const importes = calcularImportesComprobante(lineas, body.tipo_comprobante, ivaDefault, precioNetoEnLineas);
    const totalLeido = preview.totales?.total;
    const percepciones = 0;
    const totalBaseLeido =
      typeof totalLeido === 'number' && Number.isFinite(totalLeido)
        ? Math.max(0, Math.round((totalLeido - percepciones) * 100) / 100)
        : null;
    const base = importesPreferiendoTotalInformado(importes, totalBaseLeido);
    return {
      subtotal: base.subtotal,
      iva_monto: base.iva_monto,
      percepcion_iibb_monto: 0,
      percepcion_iva_monto: 0,
      impuesto_interno_monto: 0,
      total: base.total,
    };
  }

  private async existeDuplicado(tenantId: string, body: ConfirmarImportadoBody): Promise<boolean> {
    const numero = numeroComprobanteImportado(body.punto_venta, body.numero_documento);
    if (numero == null) return false;
    const where: Record<string, unknown> = {
      tenantId,
      estado: EstadoComprobante.importado,
      tipoOperacion: body.tipo_operacion,
      tipo: body.tipo_comprobante,
      numero,
    };
    if (body.tipo_operacion === 'compra' && body.proveedor_id) where.proveedorId = body.proveedor_id;
    if (body.tipo_operacion === 'venta' && body.cliente_id) where.clienteId = body.cliente_id;
    const dup = await this.comprobanteRepo.findOne({ where: where as never });
    return Boolean(dup);
  }
}
