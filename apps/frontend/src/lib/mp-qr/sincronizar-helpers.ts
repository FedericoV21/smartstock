import { MpQrError } from '@/lib/mp-qr/client';

/**
 * MP a veces no permite GET de la orden instore (403 PolicyAgent, 404/405 con store v2).
 * Eso no implica fallo del cobro: la orden se cargó con PUT y el pago llega por webhook.
 */
export function mpQrErrorEsConsultaOrdenNoDisponible(e: unknown): boolean {
  if (!(e instanceof MpQrError)) return false;
  if (e.status === 403 || e.status === 404 || e.status === 405) return true;
  const blob = `${e.code} ${e.message}`.toLowerCase();
  return (
    blob.includes('policyagent') ||
    blob.includes('pointofsaleinstoreorder') ||
    (e.status !== 401 && blob.includes('unauthorized')) ||
    blob.includes('not found')
  );
}

export function respuestaSincronizarEsperandoQr(extras: Record<string, unknown> = {}) {
  return {
    estado: 'pendiente_qr' as const,
    estado_nexus: 'pendiente_qr' as const,
    proceso_qr_ejecutado: false,
    consulta_mp_omitida: true,
    ...extras,
  };
}
