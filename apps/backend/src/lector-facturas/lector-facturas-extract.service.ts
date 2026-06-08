import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ImportacionLog } from '../importaciones/entities/importacion-log.entity';
import { OrigenPrecio } from '../pricing/enums/origen-precio.enum';
import { Producto } from '../products/entities/producto.entity';
import { LectorFacturaLog } from './entities/lector-factura-log.entity';
import { LectorStorageService } from './lector-storage.service';
import { LectorFacturasBaseService } from './lector-facturas-base.service';
import { LectorFacturasLimiteService } from './lector-facturas-limite.service';
import { detectarDireccion } from './utils/factura-direccion.util';
import type { FacturaGeminiPayload } from './utils/factura-extraccion.util';
import { matchearItemsFactura } from './utils/factura-item-matching.util';
import type { ArchivoFacturaResumen } from './utils/factura-multipagina.util';
import {
  archivoNombreLog,
  extraerFacturaIaPura,
  validarArchivosFacturaIa,
  type ArchivoFacturaEntrada,
  type HojaExtraccionFactura,
} from './utils/extraer-factura-ia-pura.util';
import { lectorFacturaExtraccionPermitida } from './utils/lector-rate-limit.util';

export type ProcesarFacturaIaSource = 'plataforma' | 'api_publica' | 'whatsapp';

export type LectorFacturaPreviewPayload = {
  log_id: string;
  iva_default: number;
  direccion: 'recibida' | 'emitida' | 'desconocida';
  cabecera: {
    tipo_comprobante: string;
    letra: string | null;
    punto_venta: number | null;
    numero: number | null;
    fecha_emision: string | null;
    fecha_vencimiento: string | null;
    cae: string | null;
    cae_vencimiento: string | null;
  };
  emisor: FacturaGeminiPayload['emisor'];
  receptor: FacturaGeminiPayload['receptor'];
  proveedor: { id: string; nombre: string } | null;
  cliente: { id: string; nombre: string } | null;
  crear_proveedor: { razon_social: string; cuit: string } | null;
  crear_cliente: { razon_social: string; cuit_dni: string } | null;
  items: Array<{
    indice: number;
    codigo: string | null;
    descripcion: string;
    cantidad: number;
    unidad: string | null;
    precio_unitario: number;
    bonificacion: number | null;
    subtotal: number;
    iva_porcentaje: number;
    producto_unidad: string | null;
    producto_unidad_compra: string | null;
    producto_contenido_unidad_compra: number | null;
    match: {
      producto_id: string | null;
      confidence: number;
      metodo: string;
      producto_nombre: string | null;
      requires_review: boolean;
    };
  }>;
  totales: {
    subtotal: number | null;
    iva_21: number | null;
    iva_10_5: number | null;
    iva_27: number | null;
    percepcion_iibb: number | null;
    percepcion_iva: number | null;
    impuesto_interno: number | null;
    otros_impuestos: number | null;
    total: number | null;
  };
  condicion_pago: string | null;
  observaciones: string | null;
  validacion: {
    totales_cuadran: boolean;
    advertencias: string[];
    items_cuadran: boolean;
    suma_items: number;
    referencia_items: number | null;
    diferencia_items: number | null;
  };
  multipagina: Record<string, unknown>;
  archivo_nombre: string;
  extracciones_restantes: number | null;
};

export type ProcesarFacturaIaResult =
  | { ok: true; payload: LectorFacturaPreviewPayload }
  | { ok: false; status: number; error: string; respuesta_raw?: string };

function parseJsonParaLog(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return { raw: texto.slice(0, 50_000) };
  }
}

function hojaLog(hoja: HojaExtraccionFactura['hoja']) {
  return {
    indice: hoja.indice,
    archivoIndice: hoja.archivoIndice,
    archivoNombre: hoja.archivoNombre,
    pagina: hoja.pagina,
    paginasArchivo: hoja.paginasArchivo,
    label: hoja.label,
  };
}

function resultadoHojaLog(r: HojaExtraccionFactura) {
  return {
    hoja: hojaLog(r.hoja),
    raw: r.texto.slice(0, 50_000),
    json: parseJsonParaLog(r.texto),
    _ia: r.meta,
  };
}

function sourceLabel(source: ProcesarFacturaIaSource): string {
  if (source === 'api_publica') return 'API factura';
  if (source === 'whatsapp') return 'WhatsApp factura';
  return 'IA factura';
}

function matchRequiresReview(match: {
  producto_id: string | null;
  confidence: number;
  metodo: string;
}): boolean {
  if (!match.producto_id || match.metodo === 'sin_match') return true;
  return match.confidence < 0.8;
}

@Injectable()
export class LectorFacturasExtractService {
  constructor(
    private readonly base: LectorFacturasBaseService,
    private readonly limiteService: LectorFacturasLimiteService,
    private readonly storage: LectorStorageService,
    @InjectRepository(LectorFacturaLog)
    private readonly logRepo: Repository<LectorFacturaLog>,
    @InjectRepository(ImportacionLog)
    private readonly importLogRepo: Repository<ImportacionLog>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
  ) {}

  async extraer(files: Express.Multer.File[] | undefined, user: AccessTokenPayload) {
    await this.base.assertModuloLector();
    this.base.assertNotVisor(user);

    const archivos = this.multerFilesToEntrada(files);

    if (!process.env.GEMINI_API_KEY?.trim()) {
      throw new ServiceUnavailableException('GEMINI_API_KEY no configurada');
    }
    const validacion = validarArchivosFacturaIa(archivos);
    if (!validacion.ok) {
      throw new HttpException(validacion.error, validacion.status);
    }

    const result = await this.procesarFacturaIa({
      tenantId: this.base.getTenantId(),
      userId: user.sub,
      archivos,
      source: 'plataforma',
    });

    if (!result.ok) {
      throw new HttpException(
        {
          error: result.error,
          ...(result.respuesta_raw ? { respuesta_raw: result.respuesta_raw } : {}),
        },
        result.status,
      );
    }

    return result.payload;
  }

  async procesarFacturaIa(params: {
    tenantId: string;
    userId: string;
    archivos: ArchivoFacturaEntrada[];
    source: ProcesarFacturaIaSource;
    aplicarRateLimit?: boolean;
    aplicarLimiteMensual?: boolean;
  }): Promise<ProcesarFacturaIaResult> {
    const {
      tenantId,
      userId,
      archivos,
      source,
      aplicarRateLimit = true,
      aplicarLimiteMensual = true,
    } = params;

    if (!process.env.GEMINI_API_KEY?.trim()) {
      return { ok: false, status: 503, error: 'GEMINI_API_KEY no configurada' };
    }

    if (aplicarRateLimit && !lectorFacturaExtraccionPermitida(tenantId)) {
      return {
        ok: false,
        status: 429,
        error: 'Demasiadas extracciones en poco tiempo. Espera un minuto e intenta de nuevo.',
      };
    }

    let limiteInfo = { permitido: true, usadas: 0, limite: null as number | null };
    if (aplicarLimiteMensual) {
      try {
        const inicioMes = new Date();
        inicioMes.setDate(1);
        inicioMes.setHours(0, 0, 0, 0);
        const [usadas, tenant] = await Promise.all([
          this.importLogRepo
            .createQueryBuilder('log')
            .where('log.tenant_id = :tenantId', { tenantId })
            .andWhere('log.origen = :origen', { origen: 'lector_factura' })
            .andWhere('log.created_at >= :inicioMes', { inicioMes })
            .getCount(),
          this.tenantRepo.findOne({
            where: { id: tenantId },
            select: { plan: true, iaIlimitadaOrigen: true },
          }),
        ]);

        const limiteMensual = this.limiteService.limiteMensualIA();
        if (!tenant) {
          limiteInfo = { permitido: false, usadas, limite: limiteMensual };
        } else if (tenant.plan === 'completo') {
          limiteInfo = { permitido: true, usadas, limite: null };
        } else if (tenant.plan === 'intermedio' && tenant.iaIlimitadaOrigen === 'lector_factura') {
          limiteInfo = { permitido: true, usadas, limite: null };
        } else {
          limiteInfo = { permitido: usadas < limiteMensual, usadas, limite: limiteMensual };
        }
      } catch (e) {
        return { ok: false, status: 500, error: (e as Error).message };
      }

      if (!limiteInfo.permitido) {
        return { ok: false, status: 429, error: 'Limite mensual de extracciones IA alcanzado' };
      }
    }

    const validacionArchivos = validarArchivosFacturaIa(archivos);
    if (!validacionArchivos.ok) return validacionArchivos;
    const totalBytes = validacionArchivos.totalBytes;

    const archivosGuardados: ArchivoFacturaResumen[] = [];
    for (let i = 0; i < archivos.length; i++) {
      const archivo = archivos[i]!;
      const { path: storagePath, error: upErr } = await this.storage.subirArchivoFacturaRecibida(
        tenantId,
        archivo.bytes,
        archivo.name,
        archivo.type,
      );

      if (upErr) {
        return { ok: false, status: 500, error: `No se pudo guardar el archivo: ${upErr.message}` };
      }

      archivosGuardados.push({
        indice: i,
        nombre: archivo.name,
        mimeType: archivo.type,
        size: archivo.size,
        storagePath,
      });
    }

    const storagePathPrincipal = archivosGuardados[0]?.storagePath ?? '';
    const nombreLog = archivoNombreLog(archivos);
    const mimeLog = archivos.length === 1 ? archivos[0]!.type : 'multipart/mixed';

    const extraccion = await extraerFacturaIaPura({ archivos, source });
    if (!extraccion.ok) {
      await this.logRepo.save(
        this.logRepo.create({
          tenantId,
          usuarioId: userId,
          archivoUrl: storagePathPrincipal,
          archivoNombre: nombreLog,
          archivoMime: mimeLog,
          archivoTamano: totalBytes,
          geminiRaw: {
            error: true,
            source,
            mensaje: extraccion.error,
            archivos: archivosGuardados,
            hojas: extraccion.hojasResumen ?? [],
            ...(extraccion.hoja ? { hoja: hojaLog(extraccion.hoja) } : {}),
            ...(extraccion.texto ? { raw: extraccion.texto.slice(0, 50_000) } : {}),
            ...(extraccion.meta ? { _ia: extraccion.meta } : {}),
            ...(extraccion.attempts?.length ? { attempts: extraccion.attempts } : {}),
          },
          datosExtraidos: null,
          direccion: 'desconocida',
          estado: 'error',
          errorMensaje: extraccion.error,
        }),
      );
      return {
        ok: false,
        status: extraccion.status,
        error: extraccion.error,
        ...(extraccion.respuesta_raw ? { respuesta_raw: extraccion.respuesta_raw } : {}),
      };
    }

    const payload = extraccion.payload;
    const validacion = extraccion.validacion;
    const resultadosOriginales = extraccion.resultadosOriginales;
    const resultadosReintento = extraccion.resultadosReintento;
    const resultadosFinales = extraccion.resultadosFinales;
    const reintentoError = extraccion.reintentoError;
    const hojasResumen = extraccion.hojasResumen;

    const tenantRow = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { cuit: true, ivaPorcentajeDefault: true },
    });

    const tenantCuit = tenantRow?.cuit ?? null;
    const ivaDefaultTenant = Number(tenantRow?.ivaPorcentajeDefault ?? 21);

    await this.importLogRepo.save(
      this.importLogRepo.create({
        tenantId,
        proveedorId: null,
        archivoNombre: `[${sourceLabel(source)}] ${nombreLog}`,
        origen: OrigenPrecio.lector_factura,
        totalFilas: payload.items.length,
        filasExitosas: payload.items.length,
        filasConError: 0,
        productosCreados: 0,
        productosActualizados: 0,
        detalleErrores: null,
        usuarioId: userId,
      }),
    );

    const direccionInfo = await detectarDireccion({
      proveedorRepo: this.proveedorRepo,
      clienteRepo: this.clienteRepo,
      tenantId,
      tenantCuit,
      emisorCuit: payload.emisor.cuit,
      receptorCuit: payload.receptor.cuit_dni,
      emisorRazonSocial: payload.emisor.razon_social,
      receptorRazonSocial: payload.receptor.razon_social,
    });

    const productos = await this.productoRepo.find({
      where: { tenantId, activo: true },
      select: ['id', 'codigo', 'nombre', 'ivaPorcentaje', 'unidad'],
    });

    const ivaPorProducto = new Map(
      productos.map((p) => [p.id, p.ivaPorcentaje != null ? Number(p.ivaPorcentaje) : null]),
    );
    const unidadPorProducto = new Map(productos.map((p) => [p.id, p.unidad as string]));

    const catalogo = productos.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
    }));

    const porItemId = matchearItemsFactura(payload.items, catalogo);

    const itemsResp = payload.items.map((it, indice) => {
      const mid = `fact-${indice}`;
      const m = porItemId.get(mid)!;
      const pid = m.producto_id;
      const ivaPct = pid != null ? (ivaPorProducto.get(pid) ?? ivaDefaultTenant) : ivaDefaultTenant;
      const match = {
        producto_id: m.producto_id,
        confidence: m.confidence,
        metodo: m.metodo,
        producto_nombre: m.producto_nombre,
        requires_review: matchRequiresReview(m),
      };
      return {
        indice,
        codigo: it.codigo,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: it.unidad,
        precio_unitario: it.precio_unitario,
        bonificacion: it.bonificacion,
        subtotal: it.subtotal,
        iva_porcentaje: ivaPct,
        producto_unidad: pid != null ? unidadPorProducto.get(pid) ?? null : null,
        producto_unidad_compra: null,
        producto_contenido_unidad_compra: null,
        match,
      };
    });

    let proveedorPayload: { id: string; nombre: string } | null = null;
    if (direccionInfo.proveedor_id) {
      const p = await this.proveedorRepo.findOne({
        where: { id: direccionInfo.proveedor_id },
        select: ['id', 'nombre'],
      });
      proveedorPayload = p ? { id: p.id, nombre: p.nombre } : null;
    }

    let clientePayload: { id: string; nombre: string } | null = null;
    if (direccionInfo.cliente_id) {
      const c = await this.clienteRepo.findOne({
        where: { id: direccionInfo.cliente_id },
        select: ['id', 'nombre'],
      });
      clientePayload = c ? { id: c.id, nombre: c.nombre } : null;
    }

    const multipaginaLog = {
      total_archivos: archivos.length,
      total_hojas: hojasResumen.length,
      archivos: archivosGuardados,
      hojas: hojasResumen,
      reintento_usado: resultadosFinales === resultadosReintento,
      ...(reintentoError ? { reintento_error: reintentoError } : {}),
    };

    const datosExtraidos = {
      direccion: direccionInfo.direccion,
      cabecera: {
        tipo_comprobante: payload.tipo_comprobante,
        letra: payload.letra,
        punto_venta: payload.punto_venta,
        numero: payload.numero,
        fecha_emision: payload.fecha_emision,
        fecha_vencimiento: payload.fecha_vencimiento,
        cae: payload.cae,
        cae_vencimiento: payload.cae_vencimiento,
      },
      emisor: payload.emisor,
      receptor: payload.receptor,
      proveedor_id: direccionInfo.proveedor_id,
      cliente_id: direccionInfo.cliente_id,
      items: itemsResp,
      totales: {
        subtotal: payload.subtotal,
        iva_21: payload.iva_21,
        iva_10_5: payload.iva_10_5,
        iva_27: payload.iva_27,
        percepcion_iibb: payload.percepcion_iibb,
        percepcion_iva: payload.percepcion_iva,
        impuesto_interno: payload.impuesto_interno,
        otros_impuestos: payload.otros_impuestos,
        total: payload.total,
      },
      condicion_pago: payload.condicion_pago,
      observaciones: payload.observaciones,
      validacion,
      multipagina: multipaginaLog,
    };

    const geminiRawPayload = {
      _multipagina: multipaginaLog,
      source,
      hojas: resultadosOriginales.map(resultadoHojaLog),
      ...(resultadosReintento ? { reintento_hojas: resultadosReintento.map(resultadoHojaLog) } : {}),
      payload_final: payload,
    };

    const logRow = await this.logRepo.save(
      this.logRepo.create({
        tenantId,
        usuarioId: userId,
        archivoUrl: storagePathPrincipal,
        archivoNombre: nombreLog,
        archivoMime: mimeLog,
        archivoTamano: totalBytes,
        geminiRaw: geminiRawPayload,
        datosExtraidos,
        direccion: direccionInfo.direccion,
        estado: 'extraido',
        proveedorId: direccionInfo.proveedor_id,
        clienteId: direccionInfo.cliente_id,
      }),
    );

    let limiteFinal = limiteInfo;
    if (aplicarLimiteMensual) {
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);
      const usadas = await this.importLogRepo
        .createQueryBuilder('log')
        .where('log.tenant_id = :tenantId', { tenantId })
        .andWhere('log.origen = :origen', { origen: 'lector_factura' })
        .andWhere('log.created_at >= :inicioMes', { inicioMes })
        .getCount();
      limiteFinal = { ...limiteInfo, usadas };
    }

    const extraccionesRestantes =
      limiteFinal.limite == null ? null : Math.max(0, limiteFinal.limite - limiteFinal.usadas);

    return {
      ok: true,
      payload: {
        log_id: logRow.id,
        iva_default: ivaDefaultTenant,
        direccion: direccionInfo.direccion,
        cabecera: datosExtraidos.cabecera,
        emisor: payload.emisor,
        receptor: payload.receptor,
        proveedor: proveedorPayload,
        cliente: clientePayload,
        crear_proveedor: direccionInfo.crear_proveedor,
        crear_cliente: direccionInfo.crear_cliente,
        items: itemsResp,
        totales: datosExtraidos.totales,
        condicion_pago: payload.condicion_pago,
        observaciones: payload.observaciones,
        validacion,
        multipagina: multipaginaLog,
        archivo_nombre: nombreLog,
        extracciones_restantes: extraccionesRestantes,
      },
    };
  }

  private multerFilesToEntrada(files: Express.Multer.File[] | undefined): ArchivoFacturaEntrada[] {
    if (!files?.length) {
      throw new BadRequestException('No se envio ningun archivo');
    }
    return files.map((file, i) => ({
      name: file.originalname || `factura-${i + 1}`,
      type: file.mimetype,
      size: file.size,
      bytes: new Uint8Array(file.buffer),
    }));
  }
}
