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
  metodo_pago?: 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'mixto' | 'posnet_mp';
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
  /**
   * Emitir factura fiscal por un ticket ya emitido (sin mover stock de nuevo).
   * El ticket debe ser `emitido`, tipo `ticket` y sin `fiscalizado_por_id`.
   */
  desde_ticket_id?: string | null;
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

/** CAE de comprobantes electrónicos AFIP: 14 dígitos. Otros valores en BD no deben bloquear la numeración. */
function caeAfipFormatoValido(cae: string | null | undefined): boolean {
  return typeof cae === 'string' && /^\d{14}$/.test(cae.trim());
}

/** Último número fiscal ya autorizado en Nexus (CAE válido). Evita reutilizar el 1 si FECompUltimoAutorizado devolvió 0 por PV/ambiente/parseo. */
async function ultimoNumeroLocalConCaeValido(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  tipo: TipoComprobante,
): Promise<number> {
  const { data, error } = await supabase
    .from('comprobante')
    .select('numero, cae')
    .eq('tenant_id', tenantId)
    .eq('tipo', tipo)
    .gt('numero', 0)
    .not('cae', 'is', null);

  if (error) {
    throw new Error(`Error al leer numeración local con CAE: ${error.message}`);
  }

  let max = 0;
  for (const row of data ?? []) {
    if (caeAfipFormatoValido(row.cae) && row.numero > max) {
      max = row.numero;
    }
  }
  return max;
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
    .select('id, numero, estado, cae, notas, numero_orden')
    .eq('tenant_id', tenantId)
    .eq('tipo', tipo)
    .eq('numero', numero)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al verificar conflictos de numeración: ${error.message}`);
  }

  if (!conflicto) return null;

  if (caeAfipFormatoValido(conflicto.cae)) {
    const ordenHint =
      conflicto.numero_orden != null
        ? ` La orden de venta de ese registro es #${conflicto.numero_orden} (distinta del número fiscal).`
        : '';
    return (
      `Ya hay un ${formatearTipoComprobante(tipo)} autorizado por ARCA con número fiscal ${numero}.${ordenHint} ` +
      `Si el sistema ofrece de nuevo el ${numero}, revisá punto de venta y ambiente (homologación vs producción) o sincronizá la numeración con AFIP.`
    );
  }

  const numeroArchivado = await obtenerNumeroArchivado(supabase, tenantId, tipo);
  const notaArchivo = [
    conflicto.notas?.trim(),
    `[Nexus] Registro archivado localmente como ${numeroArchivado} para liberar la numeración fiscal ${numero} (sin CAE válido AFIP; estado ${conflicto.estado}).`,
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

  let ultimoLocalConCae = 0;
  try {
    ultimoLocalConCae = await ultimoNumeroLocalConCaeValido(supabase, ctx.tenantId, tipo);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return { error: mensaje };
  }

  const ultimoArca =
    Number.isFinite(ultimoAutorizado) && ultimoAutorizado >= 0 ? ultimoAutorizado : 0;
  const ultimo = Math.max(ultimoArca, ultimoLocalConCae);
  const numero = ultimo + 1;
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

type TicketOrigenFiscal = {
  id: string;
  cliente_id: string | null;
  numero: number;
};

async function obtenerNumeroOrdenParaEmision(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string },
  ticketOrigen: TicketOrigenFiscal | null,
): Promise<{ ok: true; numeroOrden: number } | { ok: false; status: number; error: string }> {
  if (ticketOrigen) {
    const { data: t, error } = await supabase
      .from('comprobante')
      .select('numero_orden')
      .eq('id', ticketOrigen.id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    if (error) {
      return { ok: false, status: 500, error: error.message };
    }
    if (t?.numero_orden != null) {
      return { ok: true, numeroOrden: t.numero_orden };
    }
  }

  const { data, error: rpcErr } = await supabase.rpc('siguiente_numero_orden', {
    p_tenant_id: ctx.tenantId,
  });

  if (rpcErr) {
    return { ok: false, status: 500, error: rpcErr.message };
  }
  if (data == null || typeof data !== 'number') {
    return {
      ok: false,
      status: 500,
      error: 'No se pudo obtener el número de orden',
    };
  }

  return { ok: true, numeroOrden: data };
}

type PagoTomadoDelTicket = Pick<
  EmitirComprobanteBody,
  'metodo_pago' | 'metodo_pago_detalle' | 'medio_pago_opcion_id' | 'caja_id'
>;

function normalizarMetodoPagoDesdeTicket(
  mp: string | null | undefined,
): EmitirComprobanteBody['metodo_pago'] {
  if (!mp) return undefined;
  if (mp === 'mixto') return 'mixto';
  if (mp === 'posnet_mp') return 'posnet_mp';
  if (CODIGOS_MEDIO_RAPIDO.has(mp)) {
    return mp as EmitirComprobanteBody['metodo_pago'];
  }
  return undefined;
}

async function cargarPagoFiscalDesdeTicket(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  ticketId: string,
): Promise<
  { ok: true; pago: PagoTomadoDelTicket } | { ok: false; status: number; error: string }
> {
  const { data: row, error } = await supabase
    .from('comprobante')
    .select(
      'metodo_pago, metodo_pago_detalle, medio_pago_opcion_id, caja_id, tenant_id',
    )
    .eq('id', ticketId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: error.message };
  }
  if (!row || row.tenant_id !== tenantId) {
    return { ok: false, status: 404, error: 'Ticket no encontrado' };
  }

  let detalle: EmitirComprobanteBody['metodo_pago_detalle'] = undefined;
  const rawDet = row.metodo_pago_detalle;
  if (rawDet && typeof rawDet === 'object' && !Array.isArray(rawDet)) {
    detalle = rawDet as Record<string, number>;
  }

  return {
    ok: true,
    pago: {
      metodo_pago: normalizarMetodoPagoDesdeTicket(row.metodo_pago),
      metodo_pago_detalle: detalle,
      medio_pago_opcion_id: row.medio_pago_opcion_id ?? undefined,
      caja_id: row.caja_id ?? undefined,
    },
  };
}

async function resolverTicketParaFiscalizar(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  desdeTicketId: string | undefined | null,
): Promise<{ ok: true; ticket: TicketOrigenFiscal } | { ok: false; status: number; error: string }> {
  if (!desdeTicketId || typeof desdeTicketId !== 'string') {
    return { ok: false, status: 400, error: 'ID de ticket inválido' };
  }

  const { data: ticket, error } = await supabase
    .from('comprobante')
    .select('id, tenant_id, tipo, estado, fiscalizado_por_id, cliente_id, numero')
    .eq('id', desdeTicketId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: error.message };
  }
  if (!ticket || ticket.tenant_id !== tenantId) {
    return { ok: false, status: 404, error: 'Ticket no encontrado' };
  }
  if (ticket.tipo !== 'ticket') {
    return { ok: false, status: 400, error: 'El comprobante de origen no es un ticket' };
  }
  if (ticket.estado !== 'emitido') {
    return { ok: false, status: 400, error: 'Solo se puede fiscalizar un ticket en estado emitido' };
  }
  if (ticket.fiscalizado_por_id) {
    return { ok: false, status: 409, error: 'Este ticket ya fue fiscalizado' };
  }

  return {
    ok: true,
    ticket: {
      id: ticket.id,
      cliente_id: ticket.cliente_id,
      numero: ticket.numero,
    },
  };
}

export async function emitirComprobante(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; userId: string },
  body: EmitirComprobanteBody,
  opciones?: {
    generarPdfYSubir?: boolean;
    omitirMovimientosStock?: boolean;
    /** Actualiza un borrador existente (p. ej. pago Mercado Pago Point) en lugar de insertar fila nueva. */
    reemplazarComprobanteBorradorId?: string;
    mpPointPaymentId?: number | null;
  },
): Promise<EmitirComprobanteResult> {
  const generarPdfYSubir = opciones?.generarPdfYSubir !== false;
  const reemplazarId = opciones?.reemplazarComprobanteBorradorId;

  let ticketOrigen: TicketOrigenFiscal | null = null;
  if (body.desde_ticket_id) {
    const res = await resolverTicketParaFiscalizar(
      supabase,
      ctx.tenantId,
      body.desde_ticket_id,
    );
    if (!res.ok) {
      return { ok: false, status: res.status, error: res.error };
    }
    ticketOrigen = res.ticket;
  }

  const omitirMovimientosStock =
    opciones?.omitirMovimientosStock === true || ticketOrigen !== null;

  if (!body.tipo || !body.items?.length) {
    return {
      ok: false,
      status: 400,
      error: 'Faltan campos obligatorios: tipo, items',
    };
  }

  if (reemplazarId) {
    if (body.desde_ticket_id) {
      return {
        ok: false,
        status: 400,
        error: 'No se puede combinar reemplazo de borrador con fiscalización desde ticket',
      };
    }
    const { data: borrador, error: brErr } = await supabase
      .from('comprobante')
      .select('id, tenant_id, estado')
      .eq('id', reemplazarId)
      .maybeSingle();
    if (brErr) {
      return { ok: false, status: 500, error: brErr.message };
    }
    if (!borrador || borrador.tenant_id !== ctx.tenantId) {
      return { ok: false, status: 404, error: 'Comprobante borrador no encontrado' };
    }
    if (borrador.estado !== 'borrador' && borrador.estado !== 'pendiente_posnet') {
      return {
        ok: false,
        status: 400,
        error: 'El comprobante no es un borrador pendiente de emisión',
      };
    }
  }

  if (ticketOrigen && (body.tipo === 'ticket' || body.tipo === 'presupuesto' || body.tipo === 'remito')) {
    return {
      ok: false,
      status: 400,
      error: 'Debés elegir un tipo de factura (A, B o C) o nota de crédito para fiscalizar el ticket',
    };
  }

  if (ticketOrigen) {
    const enviado =
      body.cliente_id === undefined || body.cliente_id === '' || body.cliente_id === null
        ? null
        : body.cliente_id;
    if (enviado !== ticketOrigen.cliente_id) {
      return {
        ok: false,
        status: 400,
        error: 'El cliente de la factura debe ser el mismo que el del ticket (incluido consumidor final sin cliente en cuenta).',
      };
    }
  }

  let payload: EmitirComprobanteBody = body;
  if (ticketOrigen) {
    const pagoRes = await cargarPagoFiscalDesdeTicket(
      supabase,
      ctx.tenantId,
      ticketOrigen.id,
    );
    if (!pagoRes.ok) {
      return { ok: false, status: pagoRes.status, error: pagoRes.error };
    }
    payload = {
      ...body,
      metodo_pago: pagoRes.pago.metodo_pago,
      metodo_pago_detalle: pagoRes.pago.metodo_pago_detalle,
      medio_pago_opcion_id: pagoRes.pago.medio_pago_opcion_id,
      caja_id: pagoRes.pago.caja_id ?? body.caja_id,
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

  const notasFinales =
    ticketOrigen != null
      ? [
          `Fiscaliza ticket n.º ${ticketOrigen.numero}.`,
          body.notas?.trim() || null,
        ]
          .filter(Boolean)
          .join('\n\n')
      : body.notas || null;

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
    payload.medio_pago_opcion_id,
  );
  if (payload.medio_pago_opcion_id && !opcionCatalogo) {
    return {
      ok: false,
      status: 400,
      error: 'La opción de medio de pago no existe o está inactiva.',
    };
  }

  let fin: ReturnType<typeof aplicarFinanciacion>;
  let opcionFin: OpcionFinanciacion | null = null;
  let esPagoMixto = false;

  if (payload.metodo_pago === 'mixto') {
    const raw = payload.metodo_pago_detalle;
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
    if (!opcionFin && payload.metodo_pago) {
      opcionFin = await cargarFinanciacionRapida(supabase, ctx.tenantId, payload.metodo_pago);
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

  const condicionVentaPdf = esPagoMixto
    ? 'Pago mixto'
    : opcionFin?.medioNombre?.trim() || null;
  const otrosTributosPdf =
    fin.arca.impTrib > 0.005 ? fin.arca.impTrib : null;

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

  const ordenResult = await obtenerNumeroOrdenParaEmision(supabase, ctx, ticketOrigen);
  if (!ordenResult.ok) {
    return { ok: false, status: ordenResult.status, error: ordenResult.error };
  }
  const numeroOrden = ordenResult.numeroOrden;

  const puntoDeVentaComprobante = arcaConfig?.punto_de_venta ?? tenant.punto_de_venta ?? 1;

  const metodoPagoFila = esPagoMixto
    ? 'mixto'
    : opcionCatalogo
      ? opcionCatalogo.medioNombre
      : (payload.metodo_pago ?? null);

  const filaBase = {
    tenant_id: ctx.tenantId,
    tipo: tipoComprobante as never,
    numero,
    numero_orden: numeroOrden,
    fecha: hoyEnAR(),
    cliente_id: body.cliente_id || null,
    subtotal: importes.subtotal,
    iva_monto: importes.iva_monto,
    iva_porcentaje: importes.iva_porcentaje,
    total: importes.total,
    estado: 'emitido' as const,
    notas: notasFinales,
    usuario_id: ctx.userId,
    metodo_pago: metodoPagoFila,
    metodo_pago_detalle: payload.metodo_pago_detalle ?? null,
    caja_id: payload.caja_id ?? null,
    total_mercaderia: mostrarFinanciacionEnComprobante ? fin.totalMercaderia : null,
    medio_pago_opcion_id: esPagoMixto
      ? null
      : opcionCatalogo
        ? payload.medio_pago_opcion_id ?? null
        : null,
    financiacion_monto: mostrarFinanciacionEnComprobante ? fin.financiacionMonto : null,
    financiacion_porcentaje: mostrarFinanciacionEnComprobante ? fin.financiacionPorcentaje : null,
    financiacion_descripcion: mostrarFinanciacionEnComprobante ? fin.financiacionDescripcion : null,
  };

  let comprobante!: Database['public']['Tables']['comprobante']['Row'];
  let compError: { message: string } | null;

  if (reemplazarId) {
    const { error: delErr } = await supabase
      .from('comprobante_item')
      .delete()
      .eq('comprobante_id', reemplazarId);
    if (delErr) {
      return { ok: false, status: 500, error: `Error al limpiar ítems del borrador: ${delErr.message}` };
    }
    const upd = await supabase
      .from('comprobante')
      .update({
        ...filaBase,
        mp_point_intent_id: null,
        mp_point_payment_id:
          opciones?.mpPointPaymentId !== undefined ? opciones.mpPointPaymentId : null,
      })
      .eq('id', reemplazarId)
      .select()
      .single();
    if (upd.data) comprobante = upd.data;
    compError = upd.error;
  } else {
    const ins = await supabase.from('comprobante').insert(filaBase).select().single();
    if (ins.data) comprobante = ins.data;
    compError = ins.error;
  }

  if (compError) {
    return { ok: false, status: 500, error: compError.message };
  }
  if (!comprobante) {
    return { ok: false, status: 500, error: 'No se pudo persistir el comprobante' };
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

  if (ticketOrigen) {
    const { error: linkTicketErr } = await supabase
      .from('comprobante')
      .update({ fiscalizado_por_id: comprobante.id })
      .eq('id', ticketOrigen.id)
      .eq('tenant_id', ctx.tenantId);

    if (linkTicketErr) {
      return {
        ok: false,
        status: 500,
        error: `El comprobante fiscal se creó pero no se pudo marcar el ticket como fiscalizado: ${linkTicketErr.message}`,
      };
    }
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

  const omitirCuentaCorriente =
    ticketOrigen != null && ticketOrigen.cliente_id != null;

  if (!esPresupuesto && body.cliente_id && !omitirCuentaCorriente) {
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
        codigo: prod.codigo,
        unidad_medida: 'unidades',
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
        notas: notasFinales,
        cae: null,
        cae_vencimiento: null,
        condicion_venta: condicionVentaPdf,
        importe_otros_tributos: otrosTributosPdf,
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
              codigo: prod.codigo,
              unidad_medida: 'unidades',
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
              notas: notasFinales,
              cae: resultado.cae,
              cae_vencimiento: resultado.caeVencimiento,
              condicion_venta: condicionVentaPdf,
              importe_otros_tributos: otrosTributosPdf,
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
