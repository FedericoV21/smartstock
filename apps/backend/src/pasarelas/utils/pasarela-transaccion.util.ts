import type { PasarelaTransaccion } from '../entities/pasarela-transaccion.entity';

export function serializePasarelaTransaccion(row: PasarelaTransaccion) {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    sucursal_id: row.sucursalId,
    caja_id: row.cajaId,
    integracion_id: row.integracionId,
    comprobante_id: row.comprobanteId,
    proveedor: row.proveedor,
    canal: row.canal,
    tipo: row.tipo,
    estado: row.estado,
    monto: Number(row.monto),
    moneda: row.moneda,
    external_reference: row.externalReference,
    external_intent_id: row.externalIntentId,
    external_order_id: row.externalOrderId,
    external_payment_id: row.externalPaymentId,
    idempotency_key: row.idempotencyKey,
    request_payload: row.requestPayload,
    response_payload: row.responsePayload,
    ultimo_error: row.ultimoError,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

export function positiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
