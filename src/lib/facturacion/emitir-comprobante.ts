import type { SupabaseClient } from '@supabase/supabase-js';

import { calcularImportes } from '@/lib/facturacion/calcular-importes';
import {
  aplicarFinanciacion,
  aplicarFinanciacionMixto,
  PARTES_PAGO_MIXTO,
  type OpcionFinanciacion,
  type PartePagoMixto,
} from '@/lib/facturacion/financiacion';
import { consultarUltimoComprobante, solicitarCAE } from '@/lib/facturacion/arca/wsfe';
import { formatearTipoComprobante } from '@/lib/facturacion/formato';
import { generarPDF } from '@/lib/facturacion/pdf-generator';
import { determinarTipoFactura } from '@/lib/facturacion/tipo-comprobante';
import { hoyEnAR } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];
type CondicionIVA = Parameters<typeof determinarTipoFactura>[0];

/** Datos mínimos de `arca_config` para WSFE (CUIT y punto de venta obligatorios). */
type ArcaConfigEmision = {
  tenant_id: string;
  cuit_emisor: string;
  punto_de_venta: number;
  ambiente: Database['public']['Enums']['arca_ambiente'];
};

type ClienteFacturaSnapshot = Pick<
  Database['public']['Tables']['cliente']['Row'],
  'nombre' | 'razon_social' | 'cuit_dni' | 'condicion_iva' | 'direccion'
>;

export interface EmitirComprobanteBody {
  tipo: string;
  cliente_id?: string | null;
  items: { producto_id: string; cantidad: number; precio_unitario: number }[];
  notas?: string;
  iva_porcentaje?: number;
  metodo_pago?: 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'mixto';
  metodo_pago_detalle?: Record<string, number>;
  caja_id?: string;
  /**
   * Si es `false`, permite emitir con cantidades mayores al stock (venta contra stock).
   * Ausente u otro valor: se exige stock suficiente (comportamiento habitual / facturación manual).
   * El POS envía `false` cuando la preferencia "Bloquear ventas sin stock suficiente" está desactivada.
   */
  stock_bloqueante?: boolean;
  /** Opción de cuotas/recargo configurada en Medios de pago (configuración del tenant). */
  medio_pago_opcion_id?: string | null;
}

export type EmitirComprobanteSuccess = {
  comprobante: Database['public']['Tables']['comprobante']['Row'] & {
    numero: number;
    pdf_url: string | null;
  };
  importes: ReturnType<typeof calcularImportes>;
};

export type EmitirComprobanteResult =
  | { ok: true; data: EmitirComprobanteSuccess }
  | { ok: false; status: number; error: string };

function requiereAutorizacionArca(tipo: string): boolean {
  return (
    tipo === 'factura' ||
    tipo === 'nota_credito' ||
    tipo.startsWith('factura_') ||
    tipo.startsWith('nota_credito_')
  );
}

function normalizarCondicionIVA(value: string | null | undefined): CondicionIVA {
  switch (value) {
    case 'responsable_inscripto':
    case 'monotributista':
    case 'exento':
    case 'consumidor_final':
      return value;
    default:
      return 'consumidor_final';
  }
}

function resolverTipoComprobante(
  tipo: string,
  tenantCondicionIva: string | null | undefined,
  clienteCondicionIva: string | null | undefined,
): string {
  if (tipo === 'factura') {
    return determinarTipoFactura(
      normalizarCondicionIVA(tenantCondicionIva),
      normalizarCondicionIVA(clienteCondicionIva),
    );
  }

  if (tipo === 'nota_credito') {
    const tipoFactura = determinarTipoFactura(
      normalizarCondicionIVA(tenantCondicionIva),
      normalizarCondicionIVA(clienteCondicionIva),
    );
    return tipoFactura.replace('factura_', 'nota_credito_');
  }

  return tipo;
}

async function obtenerSiguienteNumeroLocal(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  tipo: TipoComprobante,
): Promise<number> {
  const { data, error } = await supabase.rpc('siguiente_numero_comprobante', {
    p_tenant_id: tenantId,
    p_tipo: tipo,
  });

  if (error) {
    throw new Error(`Error al obtener número: ${error.message}`);
  }

  return data;
}

async function obtenerNumeroArchivado(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  tipo: TipoComprobante,
): Promise<number> {
  const { data, error } = await supabase
    .from('comprobante')
    .select('numero')
    .eq('tenant_id', tenantId)
    .eq('tipo', tipo)
    .lt('numero', 0)
    .order('numero', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al reservar numeración archivada: ${error.message}`);
  }

  return (data?.numero ?? 0) - 1;
}

const CODIGOS_MEDIO_RAPIDO = new Set([
  'efectivo',
  'debito',
  'credito',
  'transferencia',
  'mixto',
]);

const LABEL_MEDIO_RAPIDO: Record<string, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
};

async function cargarOpcionFinanciacion(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opcionId: string | undefined | null,
): Promise<OpcionFinanciacion | null> {
  if (!opcionId || typeof opcionId !== 'string') return null;

  const { data, error } = await supabase
    .from('medio_pago_opcion')
    .select('id, cuotas, recargo_porcentaje, medio_pago!inner ( nombre, activo, tenant_id )')
    .eq('id', opcionId)
    .maybeSingle();

  if (error || !data) return null;

  const medio = data.medio_pago as { nombre: string; activo: boolean; tenant_id: string };
  if (medio.tenant_id !== tenantId || !medio.activo) return null;

  return {
    medioNombre: medio.nombre,
    cuotas: data.cuotas,
    recargo_porcentaje: Number(data.recargo_porcentaje),
  };
}

async function cargarMapaMediosRapidos(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('medio_pago_rapido')
    .select('codigo, recargo_porcentaje')
    .eq('tenant_id', tenantId);

  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    map[row.codigo] = Number(row.recargo_porcentaje);
  }
  return map;
}

function validarDetalleMixto(
  raw: Record<string, unknown>,
  totalEsperado: number,
):
  | { ok: true; detalle: Record<PartePagoMixto, number> }
  | { ok: false; error: string } {
  const detalle = {
    efectivo: 0,
    debito: 0,
    credito: 0,
    transferencia: 0,
  } as Record<PartePagoMixto, number>;

  for (const k of PARTES_PAGO_MIXTO) {
    const v = raw[k];
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: `Monto inválido en ${k}` };
    }
    detalle[k] = Math.round(n * 100) / 100;
  }

  const suma = Math.round(
    (detalle.efectivo + detalle.debito + detalle.credito + detalle.transferencia) * 100,
  ) / 100;
  if (Math.abs(suma - totalEsperado) > 0.02) {
    return {
      ok: false,
      error: `La suma de montos del pago mixto (${suma.toFixed(2)}) debe coincidir con el total del comprobante (${totalEsperado.toFixed(2)}).`,
    };
  }

  return { ok: true, detalle };
}

/** Recargo/descuento configurado para los botones rápidos del POS (sin opción de catálogo). */
async function cargarFinanciacionRapida(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  metodo: string | undefined | null,
): Promise<OpcionFinanciacion | null> {
  if (!metodo || metodo === 'mixto' || !CODIGOS_MEDIO_RAPIDO.has(metodo)) return null;

  const { data } = await supabase
    .from('medio_pago_rapido')
    .select('recargo_porcentaje')
    .eq('tenant_id', tenantId)
    .eq('codigo', metodo)
    .maybeSingle();

  const pct = data != null ? Number(data.recargo_porcentaje) : 0;
  if (!Number.isFinite(pct) || Math.abs(pct) < 1e-9) return null;

  return {
    medioNombre: LABEL_MEDIO_RAPIDO[metodo] ?? metodo,
    cuotas: 1,
    recargo_porcentaje: pct,
  };
}

async function liberarNumeroConflictuanteErrorArca(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  tipo: TipoComprobante,
  numero: number,
): Promise<string | null> {
  const { data: conflicto, error } = await supabase
    .from('comprobante')
    .select('id, numero, estado, cae, notas')
    .eq('tenant_id', tenantId)
    .eq('tipo', tipo)
    .eq('numero', numero)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al verificar conflictos de numeración: ${error.message}`);
  }

  if (!conflicto) return null;

  if (conflicto.estado !== 'error_arca' || conflicto.cae) {
    return `Ya existe un comprobante local con el número ${numero}. Revisá la numeración antes de reintentar.`;
  }

  const numeroArchivado = await obtenerNumeroArchivado(supabase, tenantId, tipo);
  const notaArchivo = [
    conflicto.notas?.trim(),
    `[Nexus] Registro archivado localmente como ${numeroArchivado} para liberar la numeración fiscal ${numero} tras un rechazo de ARCA.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { error: updateError } = await supabase
    .from('comprobante')
    .update({
      numero: numeroArchivado,
      notas: notaArchivo,
    })
    .eq('id', conflicto.id);

  if (updateError) {
    throw new Error(`Error al liberar número fiscal: ${updateError.message}`);
  }

  return null;
}

async function obtenerNumeroComprobanteParaEmision(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string },
  tipo: TipoComprobante,
  arcaConfig: ArcaConfigEmision | null,
): Promise<{ numero: number } | { error: string }> {
  if (!arcaConfig) {
    return { numero: await obtenerSiguienteNumeroLocal(supabase, ctx.tenantId, tipo) };
  }

  let ultimoAutorizado: number;
  try {
    ultimoAutorizado = await consultarUltimoComprobante(supabase, arcaConfig, tipo);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return {
      error: `No se pudo consultar la numeración ARCA para ${formatearTipoComprobante(tipo)}: ${mensaje}`,
    };
  }

  const numero = ultimoAutorizado + 1;
  const conflicto = await liberarNumeroConflictuanteErrorArca(
    supabase,
    ctx.tenantId,
    tipo,
    numero,
  );

  if (conflicto) {
    return { error: conflicto };
  }

  return { numero };
}

export async function emitirComprobante(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; userId: string },
  body: EmitirComprobanteBody,
  opciones?: { generarPdfYSubir?: boolean; omitirMovimientosStock?: boolean },
): Promise<EmitirComprobanteResult> {
  const generarPdfYSubir = opciones?.generarPdfYSubir !== false;
  const omitirMovimientosStock = opciones?.omitirMovimientosStock === true;

  if (!body.tipo || !body.items?.length) {
    return {
      ok: false,
      status: 400,
      error: 'Faltan campos obligatorios: tipo, items',
    };
  }

  const { data: tenant } = await supabase
    .from('tenant')
    .select('*')
    .eq('id', ctx.tenantId)
    .single();

  if (!tenant) {
    return { ok: false, status: 500, error: 'Tenant no encontrado' };
  }

  const consumidorFinal: ClienteFacturaSnapshot = {
    nombre: 'Consumidor Final',
    razon_social: null,
    cuit_dni: null,
    condicion_iva: 'consumidor_final',
    direccion: null,
  };

  let cliente: ClienteFacturaSnapshot = consumidorFinal;

  if (body.cliente_id) {
    const { data: clienteDb } = await supabase
      .from('cliente')
      .select('*')
      .eq('id', body.cliente_id)
      .single();

    if (!clienteDb) {
      return { ok: false, status: 404, error: 'Cliente no encontrado' };
    }
    cliente = clienteDb;
  }

  const tipoComprobante = resolverTipoComprobante(
    body.tipo,
    (tenant as { condicion_iva?: string | null }).condicion_iva,
    cliente.condicion_iva,
  );

  const productoIds = body.items.map((i) => i.producto_id);
  const { data: productos } = await supabase
    .from('producto')
    .select('id, codigo, nombre, stock_actual, precio_costo, iva_porcentaje')
    .in('id', productoIds);

  if (!productos || productos.length !== productoIds.length) {
    return { ok: false, status: 404, error: 'Algunos productos no fueron encontrados' };
  }

  const productosMap = new Map(productos.map((p) => [p.id, p]));

  const exigirStock = body.stock_bloqueante !== false;

  const esPresupuesto = tipoComprobante === 'presupuesto';
  if (!esPresupuesto && !omitirMovimientosStock && exigirStock) {
    const cantidadPorProducto = new Map<string, number>();
    for (const item of body.items) {
      cantidadPorProducto.set(
        item.producto_id,
        (cantidadPorProducto.get(item.producto_id) ?? 0) + item.cantidad,
      );
    }
    for (const [productoId, cantidadTotal] of cantidadPorProducto) {
      const prod = productosMap.get(productoId)!;
      if (prod.stock_actual < cantidadTotal) {
        return {
          ok: false,
          status: 400,
          error: `Stock insuficiente para "${prod.nombre}". Disponible: ${prod.stock_actual}, solicitado: ${cantidadTotal}`,
        };
      }
    }
  }

  const tenantIvaDefault = (tenant as Record<string, unknown>).iva_porcentaje_default as number | undefined;
  const ivaFallback = body.iva_porcentaje ?? tenantIvaDefault ?? 21;

  const itemsConIva = body.items.map((item) => {
    const prod = productosMap.get(item.producto_id);
    return {
      ...item,
      iva_porcentaje: prod?.iva_porcentaje ?? ivaFallback,
    };
  });

  const importesMercaderia = calcularImportes(itemsConIva, tipoComprobante, ivaFallback);

  const opcionCatalogo = await cargarOpcionFinanciacion(
    supabase,
    ctx.tenantId,
    body.medio_pago_opcion_id,
  );
  if (body.medio_pago_opcion_id && !opcionCatalogo) {
    return {
      ok: false,
      status: 400,
      error: 'La opción de medio de pago no existe o está inactiva.',
    };
  }

  let fin: ReturnType<typeof aplicarFinanciacion>;
  let opcionFin: OpcionFinanciacion | null = null;
  let esPagoMixto = false;

  if (body.metodo_pago === 'mixto') {
    const raw = body.metodo_pago_detalle;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        status: 400,
        error:
          'Pago mixto: enviá metodo_pago_detalle con montos en efectivo, débito, crédito y transferencia (la suma debe igualar el total del comprobante).',
      };
    }
    const val = validarDetalleMixto(raw as Record<string, unknown>, importesMercaderia.total);
    if (!val.ok) {
      return { ok: false, status: 400, error: val.error };
    }
    const pctMap = await cargarMapaMediosRapidos(supabase, ctx.tenantId);
    fin = aplicarFinanciacionMixto(
      importesMercaderia,
      tipoComprobante,
      val.detalle,
      pctMap,
    );
    esPagoMixto = true;
  } else {
    opcionFin = opcionCatalogo;
    if (!opcionFin && body.metodo_pago) {
      opcionFin = await cargarFinanciacionRapida(supabase, ctx.tenantId, body.metodo_pago);
    }
    fin = aplicarFinanciacion(importesMercaderia, tipoComprobante, opcionFin);
  }

  const importes = fin.importes;

  const mostrarFinanciacionEnComprobante = esPagoMixto || !!opcionFin;
  const pdfFinanciacion = {
    total_mercaderia: mostrarFinanciacionEnComprobante ? fin.totalMercaderia : null,
    financiacion_monto: mostrarFinanciacionEnComprobante ? fin.financiacionMonto : null,
    financiacion_porcentaje: mostrarFinanciacionEnComprobante ? fin.financiacionPorcentaje : null,
    financiacion_descripcion: mostrarFinanciacionEnComprobante ? fin.financiacionDescripcion : null,
  };

  const { data: moduloConfig } = await supabase
    .from('modulo_config')
    .select('facturador_arca')
    .maybeSingle();

  const arcaActivo = moduloConfig && (moduloConfig as Record<string, boolean>).facturador_arca;
  const requiereArca = arcaActivo && requiereAutorizacionArca(tipoComprobante);

  let arcaConfig: ArcaConfigEmision | null = null;
  if (requiereArca) {
    const { data } = await supabase
      .from('arca_config')
      .select('tenant_id, cuit_emisor, punto_de_venta, ambiente')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    if (data?.cuit_emisor && data.punto_de_venta != null) {
      arcaConfig = {
        tenant_id: data.tenant_id,
        cuit_emisor: data.cuit_emisor,
        punto_de_venta: data.punto_de_venta,
        ambiente: data.ambiente,
      };
    }
  }

  let numero: number;
  try {
    const numeroResult = await obtenerNumeroComprobanteParaEmision(
      supabase,
      ctx,
      tipoComprobante as TipoComprobante,
      arcaConfig,
    );

    if ('error' in numeroResult) {
      return {
        ok: false,
        status: 409,
        error: numeroResult.error,
      };
    }

    numero = numeroResult.numero;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 500,
      error: mensaje,
    };
  }

  const puntoDeVentaComprobante = arcaConfig?.punto_de_venta ?? tenant.punto_de_venta ?? 1;

  const { data: comprobante, error: compError } = await supabase
    .from('comprobante')
    .insert({
      tenant_id: ctx.tenantId,
      tipo: tipoComprobante as never,
      numero,
      fecha: hoyEnAR(),
      cliente_id: body.cliente_id || null,
      subtotal: importes.subtotal,
      iva_monto: importes.iva_monto,
      iva_porcentaje: importes.iva_porcentaje,
      total: importes.total,
      estado: 'emitido' as const,
      notas: body.notas || null,
      usuario_id: ctx.userId,
      metodo_pago: esPagoMixto
        ? 'mixto'
        : opcionCatalogo
          ? opcionCatalogo.medioNombre
          : (body.metodo_pago ?? null),
      metodo_pago_detalle: body.metodo_pago_detalle ?? null,
      caja_id: body.caja_id ?? null,
      total_mercaderia: mostrarFinanciacionEnComprobante ? fin.totalMercaderia : null,
      medio_pago_opcion_id: esPagoMixto
        ? null
        : opcionCatalogo
          ? body.medio_pago_opcion_id ?? null
          : null,
      financiacion_monto: mostrarFinanciacionEnComprobante ? fin.financiacionMonto : null,
      financiacion_porcentaje: mostrarFinanciacionEnComprobante ? fin.financiacionPorcentaje : null,
      financiacion_descripcion: mostrarFinanciacionEnComprobante ? fin.financiacionDescripcion : null,
    })
    .select()
    .single();

  if (compError) {
    return { ok: false, status: 500, error: compError.message };
  }

  const itemsInsert = importes.items.map((item) => ({
    comprobante_id: comprobante.id,
    producto_id: item.producto_id,
    cantidad: item.cantidad,
    precio_unitario: item.precio_unitario,
    subtotal: item.subtotal,
    precio_costo: productosMap.get(item.producto_id)?.precio_costo ?? 0,
  }));

  const { error: itemsError } = await supabase.from('comprobante_item').insert(itemsInsert);

  if (itemsError) {
    return { ok: false, status: 500, error: `Error al crear items: ${itemsError.message}` };
  }

  if (!esPresupuesto && !omitirMovimientosStock) {
    const esNotaCredito = tipoComprobante.startsWith('nota_credito');
    const tipoMov = esNotaCredito ? 'entrada' : 'salida';

    const permitirNegativo = !exigirStock && tipoMov === 'salida';

    for (const item of body.items) {
      const args: Parameters<SupabaseClient<Database>['rpc']>[1] = {
        p_tenant_id: ctx.tenantId,
        p_producto_id: item.producto_id,
        p_tipo: tipoMov,
        p_cantidad: item.cantidad,
        p_motivo: `${formatearTipoComprobante(tipoComprobante)} #${numero}`,
        p_referencia_tipo: 'factura',
        p_referencia_id: comprobante.id,
        p_usuario_id: ctx.userId,
        ...(permitirNegativo ? { p_permitir_stock_negativo: true } : {}),
      };
      const { error: movError } = await supabase.rpc('registrar_movimiento', args);

      if (movError) {
        const msg = movError.message ?? '';
        if (
          permitirNegativo &&
          (msg.includes('Could not find the function') || msg.includes('schema cache'))
        ) {
          return {
            ok: false,
            status: 503,
            error:
              'La base de datos no tiene la versión actualizada de registrar_movimiento. En Supabase: SQL Editor → ejecutá el archivo supabase/migrations/035_registrar_movimiento_permitir_negativo.sql (o supabase db push). Luego en Ajustes del proyecto → API → «Reload schema».',
          };
        }
        return { ok: false, status: 500, error: `Error de stock: ${msg}` };
      }
    }
  }

  if (!esPresupuesto && body.cliente_id) {
    const esNotaCredito = tipoComprobante.startsWith('nota_credito');
    const deltaDeuda = esNotaCredito ? -importes.total : importes.total;

    await supabase
      .from('cuenta_corriente')
      .upsert(
        { tenant_id: ctx.tenantId, cliente_id: body.cliente_id, saldo: 0 },
        { onConflict: 'tenant_id,cliente_id', ignoreDuplicates: true },
      );

    const { data: cuenta } = await supabase
      .from('cuenta_corriente')
      .select('id, saldo')
      .eq('tenant_id', ctx.tenantId)
      .eq('cliente_id', body.cliente_id)
      .single();

    if (cuenta) {
      await supabase
        .from('cuenta_corriente')
        .update({ saldo: cuenta.saldo + deltaDeuda })
        .eq('id', cuenta.id);
    }
  }

  let pdfUrl: string | null = null;

  if (generarPdfYSubir) {
    const itemsPDF = body.items.map((item) => {
      const prod = productosMap.get(item.producto_id)!;
      const rate = prod.iva_porcentaje ?? ivaFallback;
      const lineGross = Math.round(item.cantidad * item.precio_unitario * 100) / 100;
      const lineIva = Math.round(((lineGross * rate) / (100 + rate)) * 100) / 100;
      return {
        cantidad: item.cantidad,
        descripcion: prod.nombre,
        precio_unitario: item.precio_unitario,
        subtotal: lineGross,
        iva_porcentaje: rate,
        iva_monto: lineIva,
      };
    });

    const pdf = generarPDF(
      {
        nombre: tenant.nombre,
        razon_social: tenant.razon_social,
        cuit: tenant.cuit,
        domicilio: tenant.domicilio,
        condicion_iva: tenant.condicion_iva ?? 'consumidor_final',
        punto_de_venta: puntoDeVentaComprobante,
      },
      {
        nombre: cliente.nombre,
        razon_social: cliente.razon_social,
        cuit_dni: cliente.cuit_dni,
        condicion_iva: cliente.condicion_iva ?? 'consumidor_final',
        direccion: cliente.direccion,
      },
      {
        tipo: tipoComprobante,
        numero,
        fecha: comprobante.fecha,
        subtotal: importes.subtotal,
        iva_monto: importes.iva_monto,
        iva_porcentaje: importes.iva_porcentaje,
        total: importes.total,
        notas: body.notas || null,
        cae: null,
        cae_vencimiento: null,
        ...pdfFinanciacion,
      },
      itemsPDF,
    );

    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));
    const pdfPath = `${ctx.tenantId}/comprobantes/${tipoComprobante}_${numero}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('comprobantes')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (!uploadError) {
      const { data: publicUrl } = supabase.storage.from('comprobantes').getPublicUrl(pdfPath);
      pdfUrl = publicUrl.publicUrl;
      await supabase.from('comprobante').update({ pdf_url: pdfUrl }).eq('id', comprobante.id);
    }
  }

  // --- POST-EMISIÓN: solicitar CAE si el módulo facturador_arca está activo ---
  let cae: string | null = null;
  let caeVencimiento: string | null = null;

  if (requiereArca && arcaConfig) {
      const t99 = fin.arca.tributo99;
      const resultado = await solicitarCAE(
        supabase,
        arcaConfig,
        {
          tenantId: ctx.tenantId,
          tipo: tipoComprobante,
          numero,
          fecha: comprobante.fecha,
          clienteCuitDni: cliente.cuit_dni || null,
          importeTotal: fin.arca.importeTotal,
          importeNeto: fin.arca.importeNeto,
          importeIVA: fin.arca.importeIVA,
          alicuotaIVA: importes.iva_porcentaje,
          impTrib: fin.arca.impTrib,
          tributos:
            t99 != null
              ? [
                  {
                    id: 99,
                    descripcion: t99.descripcion,
                    baseImp: t99.baseImp,
                    alicuota: t99.alicuota,
                    importe: t99.importe,
                  },
                ]
              : undefined,
        },
        comprobante.id,
      );

      if (resultado.aprobado && resultado.cae) {
        cae = resultado.cae;
        caeVencimiento = resultado.caeVencimiento;
        await supabase
          .from('comprobante')
          .update({
            cae: resultado.cae,
            cae_vencimiento: resultado.caeVencimiento,
            estado: 'emitido' as never,
          })
          .eq('id', comprobante.id);

        if (generarPdfYSubir) {
          const itemsPDFCae = body.items.map((item) => {
            const prod = productosMap.get(item.producto_id)!;
            const rate = prod.iva_porcentaje ?? ivaFallback;
            const lineGross = Math.round(item.cantidad * item.precio_unitario * 100) / 100;
            const lineIva = Math.round(((lineGross * rate) / (100 + rate)) * 100) / 100;
            return {
              cantidad: item.cantidad,
              descripcion: prod.nombre,
              precio_unitario: item.precio_unitario,
              subtotal: lineGross,
              iva_porcentaje: rate,
              iva_monto: lineIva,
            };
          });

          const pdfConCAE = generarPDF(
            {
              nombre: tenant.nombre,
              razon_social: tenant.razon_social,
              cuit: tenant.cuit,
              domicilio: tenant.domicilio,
              condicion_iva: tenant.condicion_iva ?? 'consumidor_final',
              punto_de_venta: puntoDeVentaComprobante,
            },
            {
              nombre: cliente.nombre,
              razon_social: cliente.razon_social,
              cuit_dni: cliente.cuit_dni,
              condicion_iva: cliente.condicion_iva ?? 'consumidor_final',
              direccion: cliente.direccion,
            },
            {
              tipo: tipoComprobante,
              numero,
              fecha: comprobante.fecha,
              subtotal: importes.subtotal,
              iva_monto: importes.iva_monto,
              iva_porcentaje: importes.iva_porcentaje,
              total: importes.total,
              notas: body.notas || null,
              cae: resultado.cae,
              cae_vencimiento: resultado.caeVencimiento,
              ...pdfFinanciacion,
            },
            itemsPDFCae,
          );

          const pdfBufferCae = Buffer.from(pdfConCAE.output('arraybuffer'));
          const pdfPathCae = `${ctx.tenantId}/comprobantes/${tipoComprobante}_${numero}.pdf`;

          const { error: uploadErr } = await supabase.storage
            .from('comprobantes')
            .upload(pdfPathCae, pdfBufferCae, {
              contentType: 'application/pdf',
              upsert: true,
            });

          if (!uploadErr) {
            const { data: pubUrl } = supabase.storage.from('comprobantes').getPublicUrl(pdfPathCae);
            pdfUrl = pubUrl.publicUrl;
            await supabase.from('comprobante').update({ pdf_url: pdfUrl }).eq('id', comprobante.id);
          }
        }
      } else if (resultado.errores.some((e) => e.codigo === 'NETWORK')) {
        await supabase
          .from('comprobante')
          .update({ estado: 'pendiente_arca' as never })
          .eq('id', comprobante.id);
      } else {
        await supabase
          .from('comprobante')
          .update({ estado: 'error_arca' as never })
          .eq('id', comprobante.id);
      }
  }

  return {
    ok: true,
    data: {
      comprobante: {
        ...comprobante,
        numero,
        pdf_url: pdfUrl,
        ...(cae ? { cae, cae_vencimiento: caeVencimiento } : {}),
      },
      importes,
    },
  };
}
