/**
 * Trazas JSON en una sola línea para filtrar en Vercel / Supabase logs por prefijo `mp-posnet`.
 */
const PREFIX = '[mp-posnet]';

export function auditLogPosnet(etapa: string, data: Record<string, unknown>): void {
  const payload = { ts: new Date().toISOString(), etapa, ...data };
  try {
    console.info(PREFIX, JSON.stringify(payload));
  } catch {
    console.info(PREFIX, etapa, payload);
  }
}
