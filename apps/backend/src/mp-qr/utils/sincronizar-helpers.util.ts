import { MpQrError } from '../errors/mp-qr.error';

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
