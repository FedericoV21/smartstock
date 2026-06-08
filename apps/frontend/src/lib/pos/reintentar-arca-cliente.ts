/** Reintentos automáticos POST `/api/facturacion/:id/reintentar-arca` en el POS (efectivo / espera MP). */

export const ARCA_REINTENTOS_AUTOMATICOS_CLIENTE = 3;
export const ARCA_ESPERA_ENTRE_REINTENTOS_MS = 1_200;

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type ReintentarCaeClienteResult =
  | { ok: true; cae: string; cae_vencimiento: string | null; pdf_url: string | null }
  | { ok: false; ultimoError: string | null };

/**
 * Hasta `maxIntentos` llamadas POST a reintentar-arca (con espera entre intentos).
 * El primer fallo de emisión ya ocurrió en el servidor; esto son reintentos adicionales en el cliente.
 */
export async function reintentarCaeCliente(
  comprobanteId: string,
  options?: { maxIntentos?: number; esperaEntreMs?: number },
): Promise<ReintentarCaeClienteResult> {
  const maxIntentos = options?.maxIntentos ?? ARCA_REINTENTOS_AUTOMATICOS_CLIENTE;
  const esperaEntreMs = options?.esperaEntreMs ?? ARCA_ESPERA_ENTRE_REINTENTOS_MS;
  let ultimoError: string | null = null;

  for (let i = 0; i < maxIntentos; i++) {
    if (i > 0) await sleepMs(esperaEntreMs);
    try {
      const res = await fetch(
        `/api/facturacion/${encodeURIComponent(comprobanteId)}/reintentar-arca`,
        { method: 'POST' },
      );
      const j = (await res.json()) as {
        error?: string;
        cae?: string;
        cae_vencimiento?: string | null;
        pdf_url?: string | null;
      };
      const caeRaw = typeof j.cae === 'string' ? j.cae.replace(/\s/g, '') : '';
      if (res.ok && /^\d{14}$/.test(caeRaw)) {
        return {
          ok: true,
          cae: caeRaw,
          cae_vencimiento: j.cae_vencimiento ?? null,
          pdf_url: typeof j.pdf_url === 'string' || j.pdf_url === null ? j.pdf_url : null,
        };
      }
      ultimoError =
        typeof j.error === 'string' && j.error.trim() !== ''
          ? j.error.trim()
          : `Error ${res.status}`;
    } catch {
      ultimoError = 'Error de red al reintentar ARCA';
    }
  }

  return { ok: false, ultimoError };
}
