import type { PasarelaTransaccionEstado } from './types';

export const PASARELA_TRANSACCION_ESTADOS_ACTIVOS: PasarelaTransaccionEstado[] = [
  'creada',
  'iniciada',
  'pendiente',
  'fiscalizando',
];

type DbError = { code?: string | null; message?: string | null };

function esTablaPasarelaAusente(error: DbError | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === '42703';
}

export async function actualizarTransaccionPasarelaPorComprobante(
  db: any,
  params: {
    tenantId: string;
    comprobanteId: string;
    proveedor: string;
    canal: 'qr' | 'terminal';
    estado: PasarelaTransaccionEstado;
    externalPaymentId?: string | number | null;
    externalIntentId?: string | number | null;
    externalOrderId?: string | number | null;
    ultimoError?: string | null;
    responsePayload?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {
      estado: params.estado,
      ultimo_error: params.ultimoError ?? null,
    };
    if (params.externalPaymentId != null) patch.external_payment_id = String(params.externalPaymentId);
    if (params.externalIntentId != null) patch.external_intent_id = String(params.externalIntentId);
    if (params.externalOrderId != null) patch.external_order_id = String(params.externalOrderId);
    if (params.responsePayload !== undefined) patch.response_payload = params.responsePayload;

    const { error } = await db
      .from('pasarela_transaccion')
      .update(patch)
      .eq('tenant_id', params.tenantId)
      .eq('comprobante_id', params.comprobanteId)
      .eq('proveedor', params.proveedor)
      .eq('canal', params.canal)
      .in('estado', PASARELA_TRANSACCION_ESTADOS_ACTIVOS);

    if (error && !esTablaPasarelaAusente(error)) {
      console.warn('[pasarelas] actualizar transaccion:', error.message ?? error);
    }
  } catch (e) {
    console.warn('[pasarelas] actualizar transaccion error:', e);
  }
}

export async function insertarTransaccionPasarelaActiva(
  db: any,
  row: {
    tenant_id: string;
    sucursal_id: string;
    caja_id: string | null;
    integracion_id: string;
    comprobante_id: string;
    proveedor: string;
    canal: 'qr' | 'terminal';
    tipo: string;
    monto: number;
    external_reference?: string | null;
    idempotency_key?: string | null;
  },
): Promise<
  | { ok: true; id: string }
  | { ok: false; status: number; error: string; code?: string | null }
> {
  const { data, error } = await db
    .from('pasarela_transaccion')
    .insert({
      ...row,
      estado: 'iniciada',
      moneda: 'ARS',
    })
    .select('id')
    .single();

  if (error) {
    const code = String(error.code ?? '');
    if (code === '23505') {
      return {
        ok: false,
        status: 409,
        error: 'Esta integracion ya tiene un cobro activo. Espera, cancelalo o consulta el estado antes de iniciar otro.',
        code,
      };
    }
    return { ok: false, status: 500, error: error.message ?? 'No se pudo crear la transaccion', code };
  }

  return { ok: true, id: String(data.id) };
}

export async function marcarTransaccionPasarela(
  db: any,
  transaccionId: string,
  patch: {
    estado: PasarelaTransaccionEstado;
    external_intent_id?: string | null;
    external_order_id?: string | null;
    external_payment_id?: string | null;
    external_reference?: string | null;
    response_payload?: Record<string, unknown> | null;
    request_payload?: Record<string, unknown> | null;
    ultimo_error?: string | null;
  },
): Promise<void> {
  const { error } = await db.from('pasarela_transaccion').update(patch).eq('id', transaccionId);
  if (error) {
    console.warn('[pasarelas] marcar transaccion:', error.message ?? error);
  }
}
