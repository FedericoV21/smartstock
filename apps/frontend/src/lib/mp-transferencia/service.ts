import type { SupabaseClient } from '@supabase/supabase-js';

import { emitirComprobante } from '@/lib/facturacion/emitir-comprobante';
import { emitirBodyDesdeBorrador } from '@/lib/mp-point/borrador-body';
import { getMpTransferenciaClient, type MpPaymentSearchItem } from '@/lib/mp-transferencia/client';
import { parseFechaMp, parseMontoMp } from '@/lib/mp-transferencia/reportes';
import { getPasarelaSecret } from '@/lib/pasarelas/secrets';
import { hoyEnAR } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

type Db = SupabaseClient<Database>;

function fromMpTable(db: Db, table: string) {
  return (db as unknown as SupabaseClient).from(table);
}

export const MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY = 'mp_transferencia_habilitada';

export type MpTransferenciaMovimientoPublico = {
  id: string;
  mp_movimiento_id: string;
  fecha_operacion: string;
  fecha_hora: string | null;
  monto: number;
  moneda: string;
  transaction_type: string | null;
  payment_type: string | null;
  descripcion: string | null;
  contraparte: string | null;
};

export type MpTransferenciaVerificacionEstado =
  | { estado: 'pendiente'; mensaje: string }
  | { estado: 'sin_coincidencias'; movimientos: MpTransferenciaMovimientoPublico[] }
  | { estado: 'una_coincidencia'; movimientos: MpTransferenciaMovimientoPublico[] }
  | { estado: 'multiples'; movimientos: MpTransferenciaMovimientoPublico[] };

export function fechaMpTransferenciaHoy(): string {
  return hoyEnAR();
}

function addOneDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  return date.toISOString().slice(0, 10);
}

export function rangoDiaArgentinaUtc(ymd: string): { beginDateIso: string; endDateIso: string } {
  return {
    beginDateIso: new Date(`${ymd}T00:00:00.000-03:00`).toISOString(),
    endDateIso: new Date(`${addOneDayYmd(ymd)}T00:00:00.000-03:00`).toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function mpTransferenciaHabilitadaEnConfig(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const value = config[MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY];
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'si', 'sí', 'on', 'yes'].includes(value.trim().toLowerCase());
}

function movimientoPublico(row: Record<string, unknown>): MpTransferenciaMovimientoPublico {
  return {
    id: String(row.id),
    mp_movimiento_id: String(row.mp_movimiento_id),
    fecha_operacion: String(row.fecha_operacion),
    fecha_hora: row.fecha_hora == null ? null : String(row.fecha_hora),
    monto: Number(row.monto),
    moneda: String(row.moneda ?? 'ARS'),
    transaction_type: row.transaction_type == null ? null : String(row.transaction_type),
    payment_type: row.payment_type == null ? null : String(row.payment_type),
    descripcion: row.descripcion == null ? null : String(row.descripcion),
    contraparte: row.contraparte == null ? null : String(row.contraparte),
  };
}

export async function loadMpTransferenciaAccessToken(
  db: Db,
  params: { tenantId: string; sucursalId: string; cajaId?: string | null },
): Promise<{ ok: true; token: string } | { ok: false; status: number; error: string }> {
  let integraciones: Record<string, unknown>[] = [];

  if (params.cajaId) {
    const { data: links, error: linksErr } = await fromMpTable(db, 'pasarela_caja')
      .select('integracion_id, orden')
      .eq('tenant_id', params.tenantId)
      .eq('caja_id', params.cajaId)
      .eq('habilitado', true)
      .order('orden', { ascending: true });

    if (linksErr) return { ok: false, status: 500, error: linksErr.message };

    const ids = ((links ?? []) as Array<{ integracion_id?: unknown }>)
      .map((row) => (typeof row.integracion_id === 'string' ? row.integracion_id.trim() : ''))
      .filter(Boolean);

    if (ids.length === 0) {
      return {
        ok: false,
        status: 403,
        error: 'Transferencia MP no esta habilitada para esta caja desde Configuracion -> Pasarelas.',
      };
    }

    const ordenPorId = new Map(
      ((links ?? []) as Array<{ integracion_id?: unknown; orden?: unknown }>).map((row, idx) => [
        String(row.integracion_id ?? ''),
        Number.isFinite(Number(row.orden)) ? Number(row.orden) : idx * 10,
      ]),
    );
    const { data, error } = await fromMpTable(db, 'pasarela_integracion')
      .select('id, nombre, config_publica, secretos_cifrados')
      .eq('tenant_id', params.tenantId)
      .eq('sucursal_id', params.sucursalId)
      .eq('proveedor', 'mercado_pago')
      .eq('tipo', 'mp_qr')
      .eq('canal', 'qr')
      .eq('estado', 'activa')
      .in('id', ids);

    if (error) return { ok: false, status: 500, error: error.message };
    integraciones = ((data ?? []) as Record<string, unknown>[]).sort(
      (a, b) => (ordenPorId.get(String(a.id)) ?? 0) - (ordenPorId.get(String(b.id)) ?? 0),
    );
  } else {
    const { data, error } = await fromMpTable(db, 'pasarela_integracion')
      .select('id, nombre, config_publica, secretos_cifrados')
      .eq('tenant_id', params.tenantId)
      .eq('sucursal_id', params.sucursalId)
      .eq('proveedor', 'mercado_pago')
      .eq('tipo', 'mp_qr')
      .eq('canal', 'qr')
      .eq('estado', 'activa')
      .order('created_at', { ascending: true });

    if (error) return { ok: false, status: 500, error: error.message };
    integraciones = (data ?? []) as Record<string, unknown>[];
  }

  const integracion = integraciones.find((row) => mpTransferenciaHabilitadaEnConfig(row.config_publica));
  if (!integracion) {
    return {
      ok: false,
      status: 403,
      error:
        'El verificador de Transferencia MP esta deshabilitado. Activalo en Configuracion -> Pasarelas dentro del QR de Mercado Pago.',
    };
  }

  const token = getPasarelaSecret(integracion as { secretos_cifrados: Record<string, unknown> }, 'access_token');
  if (!token) {
    return {
      ok: false,
      status: 400,
      error: 'Configuracion de MP QR incompleta: falta Access Token para consultar transferencias.',
    };
  }
  return { ok: true, token };
}

function textoContrapartePago(pago: MpPaymentSearchItem): string | null {
  const payer = pago.payer;
  if (!payer) return null;
  const nombre = [payer.first_name, payer.last_name]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  if (nombre) return nombre;
  return typeof payer.email === 'string' && payer.email.trim() ? payer.email.trim() : null;
}

function getNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const next = value[key];
  return isRecord(next) ? next : null;
}

function resumenPagoMp(pago: MpPaymentSearchItem) {
  const pointOfInteraction = isRecord(pago.point_of_interaction) ? pago.point_of_interaction : null;
  const transactionData = getNestedRecord(pointOfInteraction, 'transaction_data');
  const transactionDetails = isRecord(pago.transaction_details) ? pago.transaction_details : null;

  return {
    id: pago.id ?? null,
    status: pago.status ?? null,
    status_detail: pago.status_detail ?? null,
    transaction_amount: pago.transaction_amount ?? null,
    date_created: pago.date_created ?? null,
    date_approved: pago.date_approved ?? null,
    currency_id: pago.currency_id ?? null,
    payment_method_id: pago.payment_method_id ?? null,
    payment_type_id: pago.payment_type_id ?? null,
    operation_type: pago.operation_type ?? null,
    point_type: pointOfInteraction?.type ?? null,
    point_sub_type: pointOfInteraction?.sub_type ?? null,
    transaction_id: transactionData?.transaction_id ?? transactionDetails?.transaction_id ?? null,
    bank_transfer_id: transactionData?.bank_transfer_id ?? transactionDetails?.bank_transfer_id ?? null,
    description: pago.description ?? null,
    contraparte: textoContrapartePago(pago),
  };
}

function resumenMovimientoMp(mov: (Omit<MpTransferenciaMovimientoPublico, 'id'> & { raw: Record<string, unknown> }) | null) {
  if (!mov) return null;
  return {
    mp_movimiento_id: mov.mp_movimiento_id,
    fecha_operacion: mov.fecha_operacion,
    fecha_hora: mov.fecha_hora,
    monto: mov.monto,
    moneda: mov.moneda,
    transaction_type: mov.transaction_type,
    payment_type: mov.payment_type,
    descripcion: mov.descripcion,
    contraparte: mov.contraparte,
  };
}

function pagoToMovimiento(pago: MpPaymentSearchItem): Omit<MpTransferenciaMovimientoPublico, 'id'> & {
  raw: Record<string, unknown>;
} | null {
  const id = pago.id != null ? String(pago.id).trim() : '';
  if (!id) return null;
  if (String(pago.status ?? '').toLowerCase() !== 'approved') return null;

  const monto = parseMontoMp(pago.transaction_amount);
  if (monto == null || monto <= 0) return null;

  const fecha = parseFechaMp(pago.date_approved ?? pago.date_created);
  if (!fecha) return null;

  return {
    mp_movimiento_id: id,
    fecha_operacion: fecha.ymd,
    fecha_hora: fecha.iso,
    monto,
    moneda: typeof pago.currency_id === 'string' && pago.currency_id.trim() ? pago.currency_id.trim() : 'ARS',
    transaction_type: String(pago.status_detail ?? pago.status ?? 'payment'),
    payment_type: String(pago.payment_type_id ?? pago.payment_method_id ?? 'payment'),
    descripcion: typeof pago.description === 'string' && pago.description.trim() ? pago.description.trim() : null,
    contraparte: textoContrapartePago(pago),
    raw: { source: 'payments_search', payment: pago },
  };
}

async function importarPagosAprobados(
  db: Db,
  params: {
    tenantId: string;
    sucursalId: string;
    fecha: string;
    accessToken: string;
  },
): Promise<void> {
  const { beginDateIso, endDateIso } = rangoDiaArgentinaUtc(params.fecha);
  const client = getMpTransferenciaClient(params.accessToken);
  const limit = 100;
  const maxResults = 500;
  let offset = 0;
  const movimientos: ReturnType<typeof pagoToMovimiento>[] = [];

  console.info('[mp-transferencia verificar] busqueda MP', {
    tenant_id: params.tenantId,
    sucursal_id: params.sucursalId,
    fecha_operacion: params.fecha,
    endpoint: 'GET /v1/payments/search',
    query: {
      status: 'approved',
      limit,
      sort: 'date_created',
      criteria: 'desc',
      begin_date: beginDateIso,
      end_date: endDateIso,
    },
  });

  while (offset < maxResults) {
    const page = await client.searchPayments({
      status: 'approved',
      limit,
      offset,
      sort: 'date_created',
      criteria: 'desc',
      beginDateIso,
      endDateIso,
    });
    const results = Array.isArray(page.results) ? page.results : [];
    const mapped = results.map(pagoToMovimiento);
    movimientos.push(...mapped);

    console.info('[mp-transferencia verificar] resultados MP', {
      tenant_id: params.tenantId,
      sucursal_id: params.sucursalId,
      fecha_operacion: params.fecha,
      offset,
      total_reportado: Number(page.paging?.total ?? 0),
      recibidos: results.length,
      pagos: results.map(resumenPagoMp),
      importables: mapped.map(resumenMovimientoMp),
    });

    const total = Number(page.paging?.total ?? 0);
    if (results.length < limit) break;
    offset += limit;
    if (total > 0 && offset >= total) break;
  }

  const rows = movimientos.filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (rows.length === 0) {
    console.info('[mp-transferencia verificar] sin pagos importables', {
      tenant_id: params.tenantId,
      sucursal_id: params.sucursalId,
      fecha_operacion: params.fecha,
    });
    return;
  }

  const { error } = await fromMpTable(db, 'mp_transferencia_movimiento').upsert(
    rows.map((m) => ({
      tenant_id: params.tenantId,
      sucursal_id: params.sucursalId,
      reporte_id: null,
      mp_movimiento_id: m.mp_movimiento_id,
      fecha_operacion: m.fecha_operacion,
      fecha_hora: m.fecha_hora,
      monto: m.monto,
      moneda: m.moneda,
      transaction_type: m.transaction_type,
      payment_type: m.payment_type,
      descripcion: m.descripcion,
      contraparte: m.contraparte,
      raw: m.raw,
    })),
    { onConflict: 'tenant_id,mp_movimiento_id' },
  );
  if (error) {
    console.error('[mp-transferencia verificar] error importando pagos MP', {
      tenant_id: params.tenantId,
      sucursal_id: params.sucursalId,
      fecha_operacion: params.fecha,
      error: error.message,
    });
    throw new Error(error.message);
  }

  console.info('[mp-transferencia verificar] pagos MP importados', {
    tenant_id: params.tenantId,
    sucursal_id: params.sucursalId,
    fecha_operacion: params.fecha,
    cantidad: rows.length,
    movimientos: rows.map(resumenMovimientoMp),
  });
}

async function buscarCoincidencias(
  db: Db,
  params: {
    tenantId: string;
    sucursalId: string;
    comprobanteId: string;
    fecha: string;
    monto: number;
  },
): Promise<MpTransferenciaMovimientoPublico[]> {
  const montoBuscado = Math.round(params.monto * 100) / 100;
  console.info('[mp-transferencia verificar] busqueda DB coincidencias', {
    tenant_id: params.tenantId,
    sucursal_id: params.sucursalId,
    comprobante_id: params.comprobanteId,
    fecha_operacion: params.fecha,
    monto_original: params.monto,
    monto_buscado: montoBuscado,
    tabla: 'mp_transferencia_movimiento',
    filtros: {
      tenant_id: params.tenantId,
      sucursal_id: params.sucursalId,
      fecha_operacion: params.fecha,
      monto: montoBuscado,
    },
  });

  const { data: rows, error } = await fromMpTable(db, 'mp_transferencia_movimiento')
    .select('id, mp_movimiento_id, fecha_operacion, fecha_hora, monto, moneda, transaction_type, payment_type, descripcion, contraparte')
    .eq('tenant_id', params.tenantId)
    .eq('sucursal_id', params.sucursalId)
    .eq('fecha_operacion', params.fecha)
    .eq('monto', montoBuscado)
    .order('fecha_hora', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  const movs = (rows ?? []) as Record<string, unknown>[];
  const ids = movs.map((m) => String(m.mp_movimiento_id)).filter(Boolean);
  if (!ids.length) {
    console.info('[mp-transferencia verificar] coincidencias DB', {
      tenant_id: params.tenantId,
      sucursal_id: params.sucursalId,
      comprobante_id: params.comprobanteId,
      encontradas_antes_de_uso: 0,
      movimientos: [],
    });
    return [];
  }

  const { data: usos } = await fromMpTable(db, 'mp_transferencia_verificacion')
    .select('mp_movimiento_id, comprobante_id, estado')
    .eq('tenant_id', params.tenantId)
    .in('mp_movimiento_id', ids)
    .in('estado', ['reservado', 'verificado']);
  const usados = new Set(
    ((usos ?? []) as Record<string, unknown>[])
      .filter((u) => u.estado === 'verificado' || String(u.comprobante_id) !== params.comprobanteId)
      .map((u) => String(u.mp_movimiento_id)),
  );
  const disponibles = movs.filter((m) => !usados.has(String(m.mp_movimiento_id))).map(movimientoPublico);
  console.info('[mp-transferencia verificar] coincidencias DB', {
    tenant_id: params.tenantId,
    sucursal_id: params.sucursalId,
    comprobante_id: params.comprobanteId,
    encontradas_antes_de_uso: movs.length,
    descartadas_por_uso: usados.size,
    disponibles: disponibles.length,
    movimientos_db: movs.map((m) => ({
      id: m.id,
      mp_movimiento_id: m.mp_movimiento_id,
      fecha_operacion: m.fecha_operacion,
      fecha_hora: m.fecha_hora,
      monto: m.monto,
      moneda: m.moneda,
      transaction_type: m.transaction_type,
      payment_type: m.payment_type,
      descripcion: m.descripcion,
      contraparte: m.contraparte,
      descartado_por_uso: usados.has(String(m.mp_movimiento_id)),
    })),
  });
  return disponibles;
}

export async function verificarTransferenciaMp(
  db: Db,
  params: {
    tenantId: string;
    sucursalId: string;
    comprobanteId: string;
    total: number;
    accessToken: string;
    fecha?: string;
  },
): Promise<MpTransferenciaVerificacionEstado> {
  const fecha = params.fecha ?? fechaMpTransferenciaHoy();
  await importarPagosAprobados(db, {
    tenantId: params.tenantId,
    sucursalId: params.sucursalId,
    fecha,
    accessToken: params.accessToken,
  });

  const movimientos = await buscarCoincidencias(db, {
    tenantId: params.tenantId,
    sucursalId: params.sucursalId,
    comprobanteId: params.comprobanteId,
    fecha,
    monto: params.total,
  });

  if (movimientos.length === 0) return { estado: 'sin_coincidencias', movimientos };
  if (movimientos.length === 1) return { estado: 'una_coincidencia', movimientos };
  return { estado: 'multiples', movimientos };
}

export async function confirmarTransferenciaMp(
  db: Db,
  params: {
    tenantId: string;
    userId: string;
    comprobante: {
      id: string;
      tenant_id: string;
      sucursal_id: string;
      estado: string;
      total: number | string;
    };
    movimientoId: string;
  },
) {
  const total = Math.round(Number(params.comprobante.total) * 100) / 100;
  const { data: mov, error: movErr } = await fromMpTable(db, 'mp_transferencia_movimiento')
    .select('*')
    .eq('id', params.movimientoId)
    .eq('tenant_id', params.tenantId)
    .eq('sucursal_id', params.comprobante.sucursal_id)
    .maybeSingle();
  if (movErr) return { ok: false as const, status: 500, error: movErr.message };
  if (!mov) return { ok: false as const, status: 404, error: 'Movimiento MP no encontrado' };
  if (Math.abs(Number(mov.monto) - total) > 0.005) {
    return { ok: false as const, status: 400, error: 'El movimiento no coincide con el total de la venta' };
  }

  const { data: uso } = await fromMpTable(db, 'mp_transferencia_verificacion')
    .select('*')
    .eq('tenant_id', params.tenantId)
    .eq('mp_movimiento_id', mov.mp_movimiento_id)
    .maybeSingle();
  if (uso && String(uso.comprobante_id) !== params.comprobante.id) {
    return { ok: false as const, status: 409, error: 'Este movimiento de Mercado Pago ya fue usado en otra venta' };
  }
  if (uso && uso.estado === 'verificado') {
    return { ok: false as const, status: 409, error: 'Este movimiento de Mercado Pago ya fue verificado' };
  }

  let verificacionId = uso?.id ? String(uso.id) : null;
  if (!verificacionId) {
    const { data: ins, error: insErr } = await fromMpTable(db, 'mp_transferencia_verificacion')
      .insert({
        tenant_id: params.tenantId,
        sucursal_id: params.comprobante.sucursal_id,
        comprobante_id: params.comprobante.id,
        movimiento_id: mov.id,
        mp_movimiento_id: mov.mp_movimiento_id,
        monto: mov.monto,
        fecha_operacion: mov.fecha_operacion,
        usuario_id: params.userId,
        estado: 'reservado',
        raw: mov.raw ?? {},
      })
      .select('id')
      .single();
    if (insErr) {
      return {
        ok: false as const,
        status: String(insErr.code) === '23505' ? 409 : 500,
        error:
          String(insErr.code) === '23505'
            ? 'Este movimiento de Mercado Pago ya fue reservado'
            : insErr.message,
      };
    }
    verificacionId = String(ins.id);
  } else if (uso.estado === 'error') {
    await fromMpTable(db, 'mp_transferencia_verificacion')
      .update({ estado: 'reservado', ultimo_error: null, usuario_id: params.userId })
      .eq('id', verificacionId);
  }

  const body = await emitirBodyDesdeBorrador(db, params.tenantId, params.comprobante.id);
  if (!body) {
    return { ok: false as const, status: 400, error: 'No se pudo armar la venta desde el borrador' };
  }
  body.metodo_pago = 'transferencia_mp';
  body.metodo_pago_detalle = {
    mp_movimiento_id: String(mov.mp_movimiento_id),
    movimiento_id: String(mov.id),
    monto: Number(mov.monto),
    fecha_operacion: String(mov.fecha_operacion),
  };

  const result = await emitirComprobante(
    db,
    { tenantId: params.tenantId, userId: params.userId },
    body,
    {
      reemplazarComprobanteBorradorId: params.comprobante.id,
      clienteSinRestriccionSucursal: true,
    },
  );

  if (!result.ok) {
    await fromMpTable(db, 'mp_transferencia_verificacion')
      .update({ estado: 'error', ultimo_error: result.error })
      .eq('id', verificacionId);
    return result;
  }

  await fromMpTable(db, 'mp_transferencia_verificacion')
    .update({
      estado: 'verificado',
      verificado_at: new Date().toISOString(),
      ultimo_error: null,
      usuario_id: params.userId,
    })
    .eq('id', verificacionId);

  return result;
}
