import { createHash, randomInt } from 'node:crypto';
import { resolveCobranzaFacturaWhatsApp } from '@/lib/cobranza/whatsapp-resolve-cobranza';
import { detectActionIntent } from '@/lib/whatsapp/action-intent';
import {
  parseClienteCobranzaFacturaRequest,
  parseClientePaymentRequest,
  parseProveedorPaymentRequest,
  parseStockAdjustmentRequest,
} from '@/lib/whatsapp/action-parsers';
import {
  validateEntityTargetName,
  validatePositiveAmount,
  validateStockAdjustmentQuantity,
} from '@/lib/whatsapp/tool-contracts';
import {
  aplicarConfirmacionLectorFacturaJob,
  resumenAplicacionLectorFactura,
} from '@/lib/lector-facturas/confirmacion-chatbot';

type ActionHandleResult =
  | { handled: false }
  | {
      handled: true;
      reply: string;
      telemetry: {
        intent: string;
        confidence: number;
        tool: string | null;
        fallbackReason: string | null;
        actionLogId?: string | null;
        actionRecordId?: string | null;
        payload?: Record<string, unknown> | null;
        result?: unknown;
      };
    };

type ActionMode = 'execute' | 'simulate';

const CONFIRMATION_WINDOW_MINUTES = 10;
const CONFIRMATION_TOKEN_DIGITS = 4;

function actionLogInboundMessageId(value: string): string | null {
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

function buildActionSignature(params: {
  wamid: string;
  toolName: string;
  payload: Record<string, unknown>;
  tenantId: string;
}) {
  const canonical = stableJson(params.payload);
  return createHash('sha256')
    .update(`${params.wamid}|${params.toolName}|${canonical}|${params.tenantId}`)
    .digest('hex');
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

function formatStockQty(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.trunc(n)) < 0.0001) return String(Math.trunc(n));
  return String(Math.round(n * 1000) / 1000);
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

type ProductoAdjustRow = {
  id: string;
  nombre: string;
  codigo: string | null;
  sucursal_id: string | null;
  activo: boolean;
};

function dedupeProductosForAdjust(productos: ProductoAdjustRow[]): ProductoAdjustRow[] {
  return uniqueBy(
    productos,
    (p) => `${normalizeText(p.nombre)}|${normalizeText(String(p.codigo ?? ''))}`,
  );
}

function buildActionDoneReply(params: {
  actionType: string;
  payload: Record<string, unknown>;
  mode: ActionMode;
  result?: unknown;
}): string {
  const proveedorNombre = String(params.payload.proveedor_nombre ?? '');
  const clienteNombre = String(params.payload.cliente_nombre ?? '');
  const productoNombre = String(params.payload.producto_nombre ?? '');
  const monto = Number(params.payload.monto ?? 0);
  const cantidad = Number(params.payload.cantidad ?? 0);

  if (params.mode === 'simulate') {
    if (params.actionType === 'lector_factura_confirmar_importado') {
      return 'Simulacion validada: carga de factura IA. No se modificaron datos.';
    }
    if (params.actionType === 'proveedor_pago_directo') {
      return `Simulacion validada: pago de ${formatAmount(monto)} al proveedor ${
        proveedorNombre || 'seleccionado'
      }. No se modificaron datos.`;
    }
    if (params.actionType === 'cliente_cobro_directo') {
      return `Simulacion validada: cobro de ${formatAmount(monto)} al cliente ${
        clienteNombre || 'seleccionado'
      }. No se modificaron datos.`;
    }
    if (params.actionType === 'cliente_cobro_factura') {
      const facturaLabel = String(params.payload.comprobante_label ?? 'factura');
      return `Simulacion validada: cobro de ${formatAmount(monto)} de ${facturaLabel} del cliente ${
        clienteNombre || 'seleccionado'
      }. No se modificaron datos.`;
    }
    return `Simulacion validada: ajuste de stock en ${
      productoNombre || 'producto'
    } por ${cantidad}. No se modificaron datos.`;
  }

  if (params.actionType === 'proveedor_pago_directo') {
    return `Pago registrado: ${formatAmount(monto)} al proveedor ${proveedorNombre || 'seleccionado'}.`;
  }
  if (params.actionType === 'cliente_cobro_directo') {
    return `Cobro registrado: ${formatAmount(monto)} al cliente ${clienteNombre || 'seleccionado'}.`;
  }
  if (params.actionType === 'cliente_cobro_factura') {
    const facturaLabel = String(params.payload.comprobante_label ?? 'factura');
    const rpcResult =
      params.result && typeof params.result === 'object'
        ? (params.result as { nuevo_saldo?: number })
        : null;
    const saldoRestante = rpcResult?.nuevo_saldo ?? params.payload.nuevo_saldo;
    const extra =
      saldoRestante != null && Number(saldoRestante) > 0.005
        ? ` Saldo pendiente: ${formatAmount(Number(saldoRestante))}.`
        : ' Factura saldada.';
    return `Cobro registrado: ${formatAmount(monto)} imputado a ${facturaLabel} (${clienteNombre || 'cliente'}).${extra}`;
  }
  if (params.actionType === 'lector_factura_confirmar_importado') {
    const applied = params.result as { comprobante_id?: string; actualizaciones_costos?: unknown[] } | null;
    if (applied?.comprobante_id) {
      return resumenAplicacionLectorFactura({
        comprobanteId: applied.comprobante_id,
        actualizacionesCostos: Array.isArray(applied.actualizaciones_costos)
          ? applied.actualizaciones_costos as any
          : [],
      });
    }
    return 'Factura cargada desde WhatsApp.';
  }
  const targetStock = params.payload.stock_objetivo;
  if (targetStock != null && Number.isFinite(Number(targetStock))) {
    return `Listo: el stock de ${productoNombre || 'producto'} quedó en ${formatStockQty(Number(targetStock))} unidades.`;
  }
  const sign = cantidad >= 0 ? 'sumé' : 'resté';
  return `Listo: ${sign} ${formatStockQty(Math.abs(cantidad))} un. en ${productoNombre || 'producto'}.`;
}

function parseConfirmation(text: string): { confirm: boolean; token: string | null; cancel: boolean } {
  const normalized = normalizeText(text);
  if (/^(cancelar|cancelo|no)\b/.test(normalized)) return { confirm: false, token: null, cancel: true };

  const withYes = normalized.match(/^(si|sí|confirmo|ok|cargar)\s+(\d{4})$/);
  if (withYes) return { confirm: true, token: withYes[2], cancel: false };
  const tokenOnly = normalized.match(/^(\d{4})$/);
  if (tokenOnly) return { confirm: true, token: tokenOnly[1], cancel: false };

  return { confirm: false, token: null, cancel: false };
}

async function resolveProveedor(db: any, tenantId: string, targetName: string) {
  const like = targetName.replace(/[%_,]/g, ' ').trim();
  const { data, error } = await db
    .from('proveedor')
    .select('id, nombre')
    .eq('tenant_id', tenantId)
    .ilike('nombre', `%${like}%`)
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; nombre: string }>;
}

async function resolveCliente(db: any, tenantId: string, targetName: string) {
  const like = targetName.replace(/[%_,]/g, ' ').trim();
  const { data, error } = await db
    .from('cliente')
    .select('id, nombre, razon_social')
    .eq('tenant_id', tenantId)
    .or(`nombre.ilike.%${like}%,razon_social.ilike.%${like}%`)
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; nombre: string; razon_social: string | null }>;
}

async function resolveProductoForAdjust(db: any, tenantId: string, targetName: string) {
  const like = targetName.replace(/[%_,]/g, ' ').trim();
  const { data, error } = await db
    .from('producto')
    .select('id, nombre, codigo, sucursal_id, activo')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .or(`nombre.ilike.%${like}%,codigo.ilike.%${like}%`)
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductoAdjustRow[];
}

async function getStockActualEnSucursal(
  db: any,
  tenantId: string,
  productoId: string,
  sucursalId: string,
): Promise<number> {
  const { data, error } = await db
    .from('stock_sucursal')
    .select('stock_actual')
    .eq('tenant_id', tenantId)
    .eq('producto_id', productoId)
    .eq('sucursal_id', sucursalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Number(data?.stock_actual ?? 0);
}

function buildStockConfirmPreview(params: {
  producto: ProductoAdjustRow;
  delta: number;
  stockActual: number;
  modo: 'delta' | 'fijar';
  target?: number;
}): string {
  const codigo = params.producto.codigo ? ` (${params.producto.codigo})` : '';
  const nombre = `${params.producto.nombre}${codigo}`;
  const actual = formatStockQty(params.stockActual);
  if (params.modo === 'fijar' && params.target != null) {
    const target = formatStockQty(params.target);
    const deltaLabel =
      params.delta >= 0 ? `+${formatStockQty(params.delta)}` : formatStockQty(params.delta);
    return `Voy a dejar ${nombre} en ${target} un. (ahora tiene ${actual}; ajuste ${deltaLabel}).`;
  }
  if (params.delta >= 0) {
    return `Voy a sumar ${formatStockQty(params.delta)} un. a ${nombre} (ahora tiene ${actual}).`;
  }
  return `Voy a restar ${formatStockQty(Math.abs(params.delta))} un. de ${nombre} (ahora tiene ${actual}).`;
}

async function executeProveedorPayment(params: {
  db: any;
  tenantId: string;
  actorUserId: string;
  payload: Record<string, unknown>;
}) {
  const { db, tenantId, actorUserId, payload } = params;
  const { data, error } = await db.rpc('registrar_pago_cuenta_proveedor', {
    p_tenant_id: tenantId,
    p_proveedor_id: payload.proveedor_id,
    p_monto: payload.monto,
    p_tipo_pago: payload.tipo_pago ?? 'efectivo',
    p_comprobante_id: null,
    p_referencia: payload.referencia ?? null,
    p_notas: payload.notas ?? null,
    p_usuario_id: actorUserId,
    p_fecha: null,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function executeCobranzaFacturaPayment(params: {
  db: any;
  actorUserId: string;
  payload: Record<string, unknown>;
}) {
  const { db, actorUserId, payload } = params;
  const { data, error } = await db.rpc('registrar_pago_cobranza', {
    p_cobranza_factura_id: payload.cobranza_factura_id,
    p_monto: payload.monto,
    p_tipo_pago: payload.tipo_pago ?? 'efectivo',
    p_notas: payload.notas ?? null,
    p_usuario_id: actorUserId,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function executeClientePayment(params: {
  db: any;
  actorUserId: string;
  payload: Record<string, unknown>;
}) {
  const { db, actorUserId, payload } = params;
  const { data, error } = await db.rpc('registrar_pago_cliente_desde_cuenta_corriente', {
    p_cliente_id: payload.cliente_id,
    p_monto: payload.monto,
    p_tipo_pago: payload.tipo_pago ?? 'efectivo',
    p_referencia: payload.referencia ?? null,
    p_notas: payload.notas ?? null,
    p_usuario_id: actorUserId,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function executeStockAdjustment(params: {
  db: any;
  tenantId: string;
  actorUserId: string;
  payload: Record<string, unknown>;
}) {
  const { db, tenantId, actorUserId, payload } = params;
  const qty = Number(payload.cantidad ?? 0);
  const movementType = qty >= 0 ? 'ajuste' : 'salida';
  const rpc = await db.rpc('registrar_movimiento', {
    p_tenant_id: tenantId,
    p_producto_id: payload.producto_id,
    p_sucursal_id: payload.sucursal_id,
    p_tipo: movementType,
    p_cantidad: Math.abs(qty),
    p_motivo: payload.motivo ?? 'Ajuste de stock via WhatsApp',
    p_referencia_tipo: 'manual',
    p_referencia_id: payload.referencia ?? 'whatsapp_action',
    p_usuario_id: actorUserId,
  });
  if (rpc.error) throw new Error(rpc.error.message);
  return rpc.data;
}

async function executeLectorFacturaConfirmacion(params: {
  db: any;
  tenantId: string;
  actorUserId: string;
  payload: Record<string, unknown>;
}) {
  const lectorJobId = typeof params.payload.lector_factura_job_id === 'string'
    ? params.payload.lector_factura_job_id
    : '';
  const impactHash = typeof params.payload.impact_hash === 'string' ? params.payload.impact_hash : '';
  if (!lectorJobId || !impactHash) {
    throw new Error('Faltan datos de confirmacion de factura.');
  }

  const { data: job, error } = await params.db
    .from('lector_factura_job')
    .select('id, tenant_id, sucursal_id, usuario_id, status, resultado, application_status, applied_comprobante_id')
    .eq('id', lectorJobId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job?.id) throw new Error('Job de factura no encontrado.');

  const applied = await aplicarConfirmacionLectorFacturaJob({
    db: params.db,
    tenantId: params.tenantId,
    job,
    sucursalId: job.sucursal_id ?? null,
    userId: job.usuario_id ?? params.actorUserId,
    acceptedImpactHash: impactHash,
  });
  if (!applied.ok) throw new Error(applied.error);
  return {
    comprobante_id: applied.comprobante_id,
    actualizaciones_costos: applied.actualizaciones_costos,
    idempotent_replay: applied.idempotent_replay,
  };
}

export async function handleWhatsAppActionMessage(params: {
  db: any;
  tenantId: string;
  actor: { id: string; usuario_id: string; rol_whatsapp: string };
  fromWaId: string;
  inboundMessageId: string;
  wamid: string;
  textBody: string;
  actionMode?: ActionMode;
  sandboxUserId?: string | null;
}): Promise<ActionHandleResult> {
  const { db, tenantId, actor, fromWaId, inboundMessageId, wamid, textBody } = params;
  const actionMode = params.actionMode ?? 'execute';
  const sandboxUserId = params.sandboxUserId ?? null;
  const persistedInboundMessageId = actionLogInboundMessageId(inboundMessageId);

  if (actionMode === 'simulate' && !sandboxUserId) {
    throw new Error('sandboxUserId es obligatorio para simular acciones de WhatsApp.');
  }

  const pendingRequest =
    actionMode === 'simulate'
      ? db
          .from('whatsapp_sandbox_pending_action' as any)
          .select(
            'id, action_type, status, confirmation_token, confirmation_expires_at, action_payload, action_signature',
          )
          .eq('tenant_id', tenantId)
          .eq('usuario_id', sandboxUserId)
          .eq('actor_id', actor.id)
          .eq('from_wa_id', fromWaId)
          .eq('status', 'pending_confirmation')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : db
          .from('whatsapp_action_log')
          .select(
            'id, action_type, action_status, confirmation_token, confirmation_expires_at, action_payload, action_signature',
          )
          .eq('tenant_id', tenantId)
          .eq('actor_id', actor.id)
          .eq('from_wa_id', fromWaId)
          .eq('action_status', 'pending_confirmation')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

  const { data: pending, error: pendingErr } = await pendingRequest;
  if (pendingErr) throw new Error(pendingErr.message);

  if (pending?.id) {
    const confirm = parseConfirmation(textBody);
    const isExpired =
      pending.confirmation_expires_at != null &&
      new Date(pending.confirmation_expires_at).getTime() < Date.now();
    if (isExpired) {
      const updatePayload =
        actionMode === 'simulate'
          ? { status: 'cancelled', error_detail: 'confirmation_expired' }
          : { action_status: 'cancelled', error_detail: 'confirmation_expired' };
      await db
        .from(actionMode === 'simulate' ? 'whatsapp_sandbox_pending_action' : 'whatsapp_action_log')
        .update(updatePayload)
        .eq('id', pending.id)
        .eq('tenant_id', tenantId);
      return {
        handled: true,
        reply: 'La confirmación venció. Pedime nuevamente la acción para generar un nuevo código.',
        telemetry: {
          intent: 'action_confirmation_expired',
          confidence: 1,
          tool: null,
          fallbackReason: 'confirmation_expired',
        },
      };
    }

    if (confirm.cancel) {
      const updatePayload =
        actionMode === 'simulate'
          ? { status: 'cancelled', error_detail: 'cancelled_by_user' }
          : { action_status: 'cancelled', error_detail: 'cancelled_by_user' };
      await db
        .from(actionMode === 'simulate' ? 'whatsapp_sandbox_pending_action' : 'whatsapp_action_log')
        .update(updatePayload)
        .eq('id', pending.id)
        .eq('tenant_id', tenantId);
      return {
        handled: true,
        reply: 'Acción cancelada. No hice ningún cambio.',
        telemetry: {
          intent: 'action_cancelled',
          confidence: 1,
          tool: null,
          fallbackReason: null,
        },
      };
    }

    if (confirm.confirm && confirm.token && confirm.token === pending.confirmation_token) {
      try {
        let result: unknown;
        let toolName = 'unknown_action_tool';
        if (actionMode === 'simulate') {
          if (pending.action_type === 'proveedor_pago_directo') {
            toolName = 'registrar_pago_cuenta_proveedor';
          } else if (pending.action_type === 'cliente_cobro_directo') {
            toolName = 'registrar_pago_cliente_desde_cuenta_corriente';
          } else if (pending.action_type === 'cliente_cobro_factura') {
            toolName = 'registrar_pago_cobranza';
          } else if (pending.action_type === 'stock_ajuste_directo') {
            toolName = 'registrar_movimiento';
          } else if (pending.action_type === 'lector_factura_confirmar_importado') {
            toolName = 'lector_factura_confirmar_importado';
          } else {
            throw new Error(`Tipo de acción no soportado: ${pending.action_type}`);
          }
          result = {
            simulated: true,
            tool: toolName,
            payload: pending.action_payload ?? {},
          };
        } else if (pending.action_type === 'proveedor_pago_directo') {
          result = await executeProveedorPayment({
            db,
            tenantId,
            actorUserId: actor.usuario_id,
            payload: pending.action_payload ?? {},
          });
          toolName = 'registrar_pago_cuenta_proveedor';
        } else if (pending.action_type === 'cliente_cobro_directo') {
          result = await executeClientePayment({
            db,
            actorUserId: actor.usuario_id,
            payload: pending.action_payload ?? {},
          });
          toolName = 'registrar_pago_cliente_desde_cuenta_corriente';
        } else if (pending.action_type === 'cliente_cobro_factura') {
          result = await executeCobranzaFacturaPayment({
            db,
            actorUserId: actor.usuario_id,
            payload: pending.action_payload ?? {},
          });
          toolName = 'registrar_pago_cobranza';
        } else if (pending.action_type === 'stock_ajuste_directo') {
          result = await executeStockAdjustment({
            db,
            tenantId,
            actorUserId: actor.usuario_id,
            payload: pending.action_payload ?? {},
          });
          toolName = 'registrar_movimiento';
        } else if (pending.action_type === 'lector_factura_confirmar_importado') {
          result = await executeLectorFacturaConfirmacion({
            db,
            tenantId,
            actorUserId: actor.usuario_id,
            payload: pending.action_payload ?? {},
          });
          toolName = 'lector_factura_confirmar_importado';
        } else {
          throw new Error(`Tipo de acción no soportado: ${pending.action_type}`);
        }
        const nowIso = new Date().toISOString();
        const updatePayload =
          actionMode === 'simulate'
            ? {
                status: 'simulated',
                confirmed_at: nowIso,
                result_payload: result,
                error_detail: null,
              }
            : {
                action_status: 'executed',
                confirmed_at: nowIso,
                executed_at: nowIso,
                result_payload: result,
                ...(persistedInboundMessageId ? { inbound_message_id: persistedInboundMessageId } : {}),
                error_detail: null,
              };
        await db
          .from(actionMode === 'simulate' ? 'whatsapp_sandbox_pending_action' : 'whatsapp_action_log')
          .update(updatePayload)
          .eq('id', pending.id)
          .eq('tenant_id', tenantId);

        const confirmationReply = buildActionDoneReply({
          actionType: String(pending.action_type),
          payload: (pending.action_payload ?? {}) as Record<string, unknown>,
          mode: actionMode,
          result,
        });

        return {
          handled: true,
          reply: confirmationReply,
          telemetry: {
            intent: `action_executed_${pending.action_type}`,
            confidence: 1,
            tool: toolName,
            fallbackReason: null,
            actionLogId: actionMode === 'simulate' ? null : String(pending.id),
            actionRecordId: actionMode === 'simulate' ? String(pending.id) : null,
            payload: (pending.action_payload ?? {}) as Record<string, unknown>,
            result,
          },
        };
      } catch (e) {
        const updatePayload =
          actionMode === 'simulate'
            ? {
                status: 'error',
                confirmed_at: new Date().toISOString(),
                error_detail: (e as Error).message,
              }
            : {
                action_status: 'error',
                confirmed_at: new Date().toISOString(),
                error_detail: (e as Error).message,
                ...(persistedInboundMessageId ? { inbound_message_id: persistedInboundMessageId } : {}),
              };
        await db
          .from(actionMode === 'simulate' ? 'whatsapp_sandbox_pending_action' : 'whatsapp_action_log')
          .update(updatePayload)
          .eq('id', pending.id)
          .eq('tenant_id', tenantId);

        return {
          handled: true,
          reply: `No pude ejecutar la acción: ${(e as Error).message}`,
          telemetry: {
            intent: 'action_execution_error',
            confidence: 1,
            tool: null,
            fallbackReason: 'execution_error',
            actionLogId: actionMode === 'simulate' ? null : String(pending.id),
            actionRecordId: actionMode === 'simulate' ? String(pending.id) : null,
            payload: (pending.action_payload ?? {}) as Record<string, unknown>,
          },
        };
      }
    }

    if (confirm.confirm && confirm.token && confirm.token !== pending.confirmation_token) {
      return {
        handled: true,
        reply: 'Código de confirmación incorrecto. Revisalo y volvé a intentar.',
        telemetry: {
          intent: 'action_confirmation_invalid_token',
          confidence: 1,
          tool: null,
          fallbackReason: 'invalid_confirmation_token',
        },
      };
    }

    return {
      handled: true,
      reply:
        'Tenés una acción pendiente. Respondé "SI ' +
        pending.confirmation_token +
        '" para confirmar o "cancelar" para anular.',
      telemetry: {
        intent: 'action_waiting_confirmation',
        confidence: 1,
        tool: null,
        fallbackReason: null,
      },
    };
  }

  let providerRequest = parseProveedorPaymentRequest(textBody);
  let cobranzaFacturaRequest = parseClienteCobranzaFacturaRequest(textBody);
  let clientRequest = cobranzaFacturaRequest ? null : parseClientePaymentRequest(textBody);
  let stockRequest = parseStockAdjustmentRequest(textBody);

  if (!providerRequest && !cobranzaFacturaRequest && !clientRequest && !stockRequest) {
    const intent = await detectActionIntent(textBody);
    if (intent.actionType === 'proveedor_pago_directo' && intent.proveedorNombre && intent.monto) {
      providerRequest = { proveedorNombre: intent.proveedorNombre, monto: intent.monto };
    } else if (
      intent.actionType === 'cliente_cobro_factura' &&
      intent.clienteNombre &&
      intent.comprobanteRef &&
      intent.monto
    ) {
      cobranzaFacturaRequest = {
        clienteNombre: intent.clienteNombre,
        comprobanteRef: intent.comprobanteRef,
        monto: intent.monto,
      };
    } else if (intent.actionType === 'cliente_cobro_directo' && intent.clienteNombre && intent.monto) {
      clientRequest = { clienteNombre: intent.clienteNombre, monto: intent.monto };
    } else if (
      intent.actionType === 'stock_ajuste_directo' &&
      intent.productoNombre &&
      intent.cantidad != null
    ) {
      const modo =
        /\b(?:cambiar|dejar|poner|llevar)\b/.test(textBody) &&
        /\b(?:a|en)\s+[\d.,]+\s*$/i.test(textBody.trim())
          ? 'fijar'
          : 'delta';
      stockRequest = {
        productoNombre: intent.productoNombre,
        cantidad: intent.cantidad,
        modo,
      };
    } else if (intent.fallbackReason === 'missing_action_slots' && intent.actionType) {
      const missing =
        intent.actionType === 'proveedor_pago_directo'
          ? 'Decime proveedor y monto. Ejemplo: registrar pago proveedor Arcor 50000'
          : intent.actionType === 'cliente_cobro_directo'
            ? 'Decime cliente y monto. Ejemplo: registrar cobro cliente Juan Perez 15000'
            : intent.actionType === 'cliente_cobro_factura'
              ? 'Decime cliente, factura/ticket (número o "ultima factura") y monto. Ejemplo: cobrar factura 42 cliente Juan Perez 15000'
              : 'Decime producto y cantidad (o stock objetivo). Ejemplo: cambiar stock Yerba Playadito a 50';
      return {
        handled: true,
        reply: missing,
        telemetry: {
          intent: 'action_missing_slots',
          confidence: intent.confidence,
          tool: null,
          fallbackReason: intent.fallbackReason,
        },
      };
    } else {
      return { handled: false };
    }
  }

  if (actor.rol_whatsapp === 'readonly') {
    return {
      handled: true,
      reply: 'Tu rol de WhatsApp es solo lectura. Pedile a un admin/owner que ejecute esta acción.',
      telemetry: {
        intent: 'action_denied_readonly_role',
        confidence: 1,
        tool: null,
        fallbackReason: 'actor_role_readonly',
      },
    };
  }

  const { data: moduloCfg, error: moduloErr } = await db
    .from('modulo_config')
    .select('stock, facturador_simple')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (moduloErr) throw new Error(moduloErr.message);
  let actionType = '';
  let toolName = '';
  let payload: Record<string, unknown> = {};
  let confirmPreview = '';
  let fallbackReason = '';
  let actionIntent = '';

  if (providerRequest) {
    if (!moduloCfg?.stock) {
      return {
        handled: true,
        reply: 'El módulo de stock/proveedores no está habilitado para este negocio.',
        telemetry: {
          intent: 'action_denied_module_disabled',
          confidence: 1,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        },
      };
    }
    const providerName = validateEntityTargetName(providerRequest.proveedorNombre, 'proveedor');
    if (!providerName.ok) {
      return {
        handled: true,
        reply: providerName.error,
        telemetry: {
          intent: 'action_provider_invalid',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'provider_invalid_name',
        },
      };
    }
    const amount = validatePositiveAmount(providerRequest.monto);
    if (!amount.ok) {
      return {
        handled: true,
        reply: amount.error,
        telemetry: {
          intent: 'action_provider_invalid_amount',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'invalid_amount',
        },
      };
    }
    const proveedores = await resolveProveedor(db, tenantId, providerName.value);
    if (proveedores.length === 0) {
      return {
        handled: true,
        reply: `No encontré un proveedor con “${providerName.value}”. Reintentá con el nombre exacto.`,
        telemetry: {
          intent: 'action_provider_not_found',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'provider_not_found',
        },
      };
    }
    if (proveedores.length > 1) {
      const options = proveedores.map((p) => `- ${p.nombre}`).join('\n');
      return {
        handled: true,
        reply: `Encontré varios proveedores parecidos:\n${options}\nDecime el nombre exacto para registrar el pago.`,
        telemetry: {
          intent: 'action_provider_ambiguous',
          confidence: 0.85,
          tool: null,
          fallbackReason: 'provider_ambiguous',
        },
      };
    }

    const proveedor = proveedores[0];
    actionType = 'proveedor_pago_directo';
    toolName = 'registrar_pago_cuenta_proveedor';
    payload = {
      proveedor_id: proveedor.id,
      proveedor_nombre: proveedor.nombre,
      monto: amount.value,
      tipo_pago: 'efectivo',
      referencia: 'whatsapp_action',
      notas: 'Pago registrado desde WhatsApp con doble confirmación',
      tool_version: 'v2',
    };
    confirmPreview = `Voy a registrar un pago de ${formatAmount(amount.value)} al proveedor ${proveedor.nombre}.`;
    fallbackReason = 'provider_payment_pending';
    actionIntent = 'action_pending_confirmation_proveedor_pago';
  } else if (cobranzaFacturaRequest) {
    if (!moduloCfg?.facturador_simple) {
      return {
        handled: true,
        reply: 'El modulo de facturacion/clientes no esta habilitado para este negocio.',
        telemetry: {
          intent: 'action_denied_module_disabled',
          confidence: 1,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        },
      };
    }
    const clientName = validateEntityTargetName(cobranzaFacturaRequest.clienteNombre, 'cliente');
    if (!clientName.ok) {
      return {
        handled: true,
        reply: clientName.error,
        telemetry: {
          intent: 'action_client_invalid',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'client_invalid_name',
        },
      };
    }
    const amount = validatePositiveAmount(cobranzaFacturaRequest.monto);
    if (!amount.ok) {
      return {
        handled: true,
        reply: amount.error,
        telemetry: {
          intent: 'action_client_invalid_amount',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'invalid_amount',
        },
      };
    }
    const clientes = await resolveCliente(db, tenantId, clientName.value);
    if (clientes.length === 0) {
      return {
        handled: true,
        reply: `No encontre un cliente con "${clientName.value}". Reintenta con el nombre exacto.`,
        telemetry: {
          intent: 'action_client_not_found',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'client_not_found',
        },
      };
    }
    if (clientes.length > 1) {
      const options = clientes.map((c) => `- ${c.razon_social || c.nombre}`).join('\n');
      return {
        handled: true,
        reply: `Encontre varios clientes parecidos:\n${options}\nDecime el nombre exacto para registrar el cobro por factura.`,
        telemetry: {
          intent: 'action_client_ambiguous',
          confidence: 0.85,
          tool: null,
          fallbackReason: 'client_ambiguous',
        },
      };
    }
    const cliente = clientes[0];
    const clientLabel = cliente.razon_social || cliente.nombre;
    const cobranza = await resolveCobranzaFacturaWhatsApp({
      db,
      tenantId,
      clienteId: cliente.id,
      comprobanteRef: cobranzaFacturaRequest.comprobanteRef,
    });
    if (!cobranza.ok) {
      return {
        handled: true,
        reply: cobranza.error,
        telemetry: {
          intent: 'action_cobranza_factura_not_found',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'cobranza_factura_not_found',
        },
      };
    }
    if (amount.value > cobranza.row.saldo_pendiente + 0.01) {
      return {
        handled: true,
        reply: `El monto (${formatAmount(amount.value)}) supera el saldo pendiente de ${cobranza.label} (${formatAmount(
          cobranza.row.saldo_pendiente,
        )}).`,
        telemetry: {
          intent: 'action_cobranza_amount_exceeds_balance',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'amount_exceeds_invoice_balance',
        },
      };
    }
    actionType = 'cliente_cobro_factura';
    toolName = 'registrar_pago_cobranza';
    payload = {
      cobranza_factura_id: cobranza.row.id,
      cliente_id: cliente.id,
      cliente_nombre: clientLabel,
      comprobante_label: cobranza.label,
      comprobante_ref: cobranzaFacturaRequest.comprobanteRef,
      monto: amount.value,
      tipo_pago: 'efectivo',
      notas: 'Cobro por factura desde WhatsApp con doble confirmacion',
      tool_version: 'v2',
    };
    confirmPreview = `Voy a registrar un cobro de ${formatAmount(amount.value)} en ${cobranza.label} del cliente ${clientLabel}.`;
    fallbackReason = 'client_invoice_payment_pending';
    actionIntent = 'action_pending_confirmation_cliente_cobro_factura';
  } else if (clientRequest) {
    if (!moduloCfg?.facturador_simple) {
      return {
        handled: true,
        reply: 'El módulo de facturación/clientes no está habilitado para este negocio.',
        telemetry: {
          intent: 'action_denied_module_disabled',
          confidence: 1,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        },
      };
    }
    const clientName = validateEntityTargetName(clientRequest.clienteNombre, 'cliente');
    if (!clientName.ok) {
      return {
        handled: true,
        reply: clientName.error,
        telemetry: {
          intent: 'action_client_invalid',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'client_invalid_name',
        },
      };
    }
    const amount = validatePositiveAmount(clientRequest.monto);
    if (!amount.ok) {
      return {
        handled: true,
        reply: amount.error,
        telemetry: {
          intent: 'action_client_invalid_amount',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'invalid_amount',
        },
      };
    }
    const clientes = await resolveCliente(db, tenantId, clientName.value);
    if (clientes.length === 0) {
      return {
        handled: true,
        reply: `No encontré un cliente con “${clientName.value}”. Reintentá con el nombre exacto.`,
        telemetry: {
          intent: 'action_client_not_found',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'client_not_found',
        },
      };
    }
    if (clientes.length > 1) {
      const options = clientes.map((c) => `- ${c.razon_social || c.nombre}`).join('\n');
      return {
        handled: true,
        reply: `Encontré varios clientes parecidos:\n${options}\nDecime el nombre exacto para registrar el cobro.`,
        telemetry: {
          intent: 'action_client_ambiguous',
          confidence: 0.85,
          tool: null,
          fallbackReason: 'client_ambiguous',
        },
      };
    }
    const cliente = clientes[0];
    const clientLabel = cliente.razon_social || cliente.nombre;
    actionType = 'cliente_cobro_directo';
    toolName = 'registrar_pago_cliente_desde_cuenta_corriente';
    payload = {
      cliente_id: cliente.id,
      cliente_nombre: clientLabel,
      monto: amount.value,
      tipo_pago: 'efectivo',
      referencia: 'whatsapp_action',
      notas: 'Cobro registrado desde WhatsApp con doble confirmación',
      tool_version: 'v2',
    };
    confirmPreview = `Voy a registrar un cobro de ${formatAmount(amount.value)} al cliente ${clientLabel}.`;
    fallbackReason = 'client_payment_pending';
    actionIntent = 'action_pending_confirmation_cliente_cobro';
  } else if (stockRequest) {
    if (!moduloCfg?.stock) {
      return {
        handled: true,
        reply: 'El módulo de stock no está habilitado para este negocio.',
        telemetry: {
          intent: 'action_denied_module_disabled',
          confidence: 1,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        },
      };
    }
    if (actor.rol_whatsapp !== 'admin' && actor.rol_whatsapp !== 'owner') {
      return {
        handled: true,
        reply: 'Solo owner/admin puede ajustar stock por WhatsApp.',
        telemetry: {
          intent: 'action_stock_role_denied',
          confidence: 1,
          tool: null,
          fallbackReason: 'actor_role_forbidden_stock_adjust',
        },
      };
    }
    const productName = validateEntityTargetName(stockRequest.productoNombre, 'producto');
    if (!productName.ok) {
      return {
        handled: true,
        reply: productName.error,
        telemetry: {
          intent: 'action_product_invalid',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'product_invalid_name',
        },
      };
    }
    const stockModo = stockRequest.modo === 'fijar' ? 'fijar' : 'delta';
    const productos = await resolveProductoForAdjust(db, tenantId, productName.value);
    const candidatos = dedupeProductosForAdjust(productos);
    if (candidatos.length === 0) {
      return {
        handled: true,
        reply: `No encontré un producto con “${productName.value}”. Probá con el código (ej. PRD-1209).`,
        telemetry: {
          intent: 'action_stock_product_not_found',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'product_not_found',
        },
      };
    }
    if (candidatos.length > 1) {
      const options = candidatos
        .map((p, i) => `${i + 1}) ${p.nombre} (${p.codigo ?? 'sin código'})`)
        .join('\n');
      return {
        handled: true,
        reply: [
          `Hay más de un producto que coincide con “${productName.value}”:`,
          options,
          '¿Cuál querés ajustar? Respondé con el número (ej: 1) o el código exacto.',
        ].join('\n'),
        telemetry: {
          intent: 'action_stock_product_ambiguous',
          confidence: 0.85,
          tool: null,
          fallbackReason: 'product_ambiguous',
        },
      };
    }
    const producto = candidatos[0];
    if (!producto.sucursal_id) {
      return {
        handled: true,
        reply: `No pude determinar la sucursal de ${producto.nombre} para ajustar stock.`,
        telemetry: {
          intent: 'action_stock_sucursal_missing',
          confidence: 0.8,
          tool: null,
          fallbackReason: 'product_sucursal_missing',
        },
      };
    }
    const stockActual = await getStockActualEnSucursal(
      db,
      tenantId,
      producto.id,
      producto.sucursal_id,
    );
    let deltaQty = stockRequest.cantidad;
    let stockObjetivo: number | undefined;
    if (stockModo === 'fijar') {
      stockObjetivo = stockRequest.cantidad;
      deltaQty = Math.round((stockObjetivo - stockActual) * 1000) / 1000;
      if (deltaQty === 0) {
        return {
          handled: true,
          reply: `${producto.nombre} ya tiene ${formatStockQty(stockActual)} un. en esa sucursal; no hace falta ajustar.`,
          telemetry: {
            intent: 'action_stock_already_at_target',
            confidence: 0.95,
            tool: null,
            fallbackReason: 'stock_already_at_target',
          },
        };
      }
    }
    const quantity = validateStockAdjustmentQuantity(deltaQty);
    if (!quantity.ok) {
      return {
        handled: true,
        reply: quantity.error,
        telemetry: {
          intent: 'action_stock_invalid_qty',
          confidence: 0.9,
          tool: null,
          fallbackReason: 'invalid_adjust_qty',
        },
      };
    }
    actionType = 'stock_ajuste_directo';
    toolName = 'registrar_movimiento';
    payload = {
      producto_id: producto.id,
      producto_nombre: producto.nombre,
      sucursal_id: producto.sucursal_id,
      cantidad: quantity.value,
      ...(stockObjetivo != null ? { stock_objetivo: stockObjetivo } : {}),
      motivo: 'Ajuste WhatsApp',
      referencia: 'whatsapp_action',
      tool_version: 'v2',
    };
    confirmPreview = buildStockConfirmPreview({
      producto,
      delta: quantity.value,
      stockActual,
      modo: stockModo,
      target: stockObjetivo,
    });
    fallbackReason = 'stock_adjust_pending';
    actionIntent = 'action_pending_confirmation_stock_adjust';
  }

  const actionSignature = buildActionSignature({
    wamid,
    toolName,
    payload,
    tenantId,
  });

  if (actionMode === 'simulate') {
    const { data: existingSandbox, error: existingSandboxErr } = await db
      .from('whatsapp_sandbox_pending_action' as any)
      .select('id, status, confirmation_token, action_payload')
      .eq('tenant_id', tenantId)
      .eq('usuario_id', sandboxUserId)
      .eq('action_signature', actionSignature)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingSandboxErr) throw new Error(existingSandboxErr.message);

    if (existingSandbox?.id && existingSandbox.status === 'simulated') {
      return {
        handled: true,
        reply: 'Esta accion ya fue simulada previamente para este mensaje. No se duplico nada.',
        telemetry: {
          intent: 'action_duplicate_ignored',
          confidence: 1,
          tool: toolName,
          fallbackReason: 'idempotency_hit_simulated',
          actionRecordId: String(existingSandbox.id),
          payload: (existingSandbox.action_payload ?? {}) as Record<string, unknown>,
        },
      };
    }

    if (existingSandbox?.id && existingSandbox.status === 'pending_confirmation') {
      return {
        handled: true,
        reply:
          'Ya tenes esta simulacion pendiente. Confirma con "SI ' +
          String(existingSandbox.confirmation_token ?? '') +
          '" o cancela con "cancelar".',
        telemetry: {
          intent: 'action_duplicate_pending',
          confidence: 1,
          tool: null,
          fallbackReason: 'idempotency_hit_pending',
          actionRecordId: String(existingSandbox.id),
          payload: (existingSandbox.action_payload ?? {}) as Record<string, unknown>,
        },
      };
    }

    const confirmationToken = String(randomInt(0, 10 ** CONFIRMATION_TOKEN_DIGITS)).padStart(
      CONFIRMATION_TOKEN_DIGITS,
      '0',
    );
    const expiresAt = new Date(Date.now() + CONFIRMATION_WINDOW_MINUTES * 60_000).toISOString();

    const { data: createdSandboxAction, error: insertSandboxErr } = await db
      .from('whatsapp_sandbox_pending_action' as any)
      .insert({
        tenant_id: tenantId,
        usuario_id: sandboxUserId,
        actor_id: actor.id,
        from_wa_id: fromWaId,
        action_type: actionType,
        status: 'pending_confirmation',
        action_signature: actionSignature,
        confirmation_token: confirmationToken,
        confirmation_expires_at: expiresAt,
        action_payload: payload,
      })
      .select('id')
      .maybeSingle();
    if (insertSandboxErr) throw new Error(insertSandboxErr.message);

    return {
      handled: true,
      reply: [
        confirmPreview,
        'Modo prueba: no se modificaran datos.',
        `Para confirmar la simulacion, responde: SI ${confirmationToken}`,
        'Si queres cancelar, responde: cancelar',
        `(vence en ${CONFIRMATION_WINDOW_MINUTES} minutos)`,
      ].join('\n'),
      telemetry: {
        intent: actionIntent,
        confidence: 0.92,
        tool: toolName,
        fallbackReason,
        actionRecordId: String(createdSandboxAction?.id ?? ''),
        payload,
      },
    };
  }

  const { data: existing, error: existingErr } = await db
    .from('whatsapp_action_log')
    .select('id, action_status, confirmation_token, action_payload')
    .eq('tenant_id', tenantId)
    .eq('action_signature', actionSignature)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);

  if (existing?.id && existing.action_status === 'executed') {
    return {
      handled: true,
      reply: 'Esta acción ya fue ejecutada previamente para este mensaje. No la voy a duplicar.',
      telemetry: {
        intent: 'action_duplicate_ignored',
        confidence: 1,
        tool: toolName,
        fallbackReason: 'idempotency_hit_executed',
        actionLogId: String(existing.id),
        payload: (existing.action_payload ?? {}) as Record<string, unknown>,
      },
    };
  }

  if (existing?.id && existing.action_status === 'pending_confirmation') {
    return {
      handled: true,
      reply:
        'Ya tenés esta acción pendiente. Confirmá con "SI ' +
        String(existing.confirmation_token ?? '') +
        '" o cancelá con "cancelar".',
      telemetry: {
        intent: 'action_duplicate_pending',
        confidence: 1,
        tool: null,
        fallbackReason: 'idempotency_hit_pending',
        actionLogId: String(existing.id),
        payload: (existing.action_payload ?? {}) as Record<string, unknown>,
      },
    };
  }

  const confirmationToken = String(randomInt(0, 10 ** CONFIRMATION_TOKEN_DIGITS)).padStart(
    CONFIRMATION_TOKEN_DIGITS,
    '0',
  );
  const expiresAt = new Date(Date.now() + CONFIRMATION_WINDOW_MINUTES * 60_000).toISOString();

  const { data: createdAction, error: insertErr } = await db
    .from('whatsapp_action_log')
    .insert({
      tenant_id: tenantId,
      actor_id: actor.id,
      ...(persistedInboundMessageId ? { inbound_message_id: persistedInboundMessageId } : {}),
      from_wa_id: fromWaId,
      action_type: actionType,
      action_status: 'pending_confirmation',
      action_signature: actionSignature,
      confirmation_token: confirmationToken,
      confirmation_expires_at: expiresAt,
      action_payload: payload,
    })
    .select('id')
    .maybeSingle();
  if (insertErr) throw new Error(insertErr.message);

  return {
    handled: true,
    reply: [
      confirmPreview,
      `Para confirmar, respondé: SI ${confirmationToken}`,
      `Si querés cancelar, respondé: cancelar`,
      `(vence en ${CONFIRMATION_WINDOW_MINUTES} minutos)`,
    ].join('\n'),
    telemetry: {
      intent: actionIntent,
      confidence: 0.92,
      tool: toolName,
      fallbackReason,
      actionLogId: String(createdAction?.id ?? ''),
      payload,
    },
  };
}
