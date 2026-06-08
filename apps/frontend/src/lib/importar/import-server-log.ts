/**
 * Logs del importador en rutas API (cuentan como Observability Events en Vercel).
 * En producción están apagados salvo errores; en dev o con DEBUG_IMPORT=1.
 */
function importVerboseEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.DEBUG_IMPORT === '1';
}

export function importServerLog(label: string, data?: Record<string, unknown>): void {
  if (!importVerboseEnabled()) return;
  if (data) console.info(label, data);
  else console.info(label);
}

export function importServerWarn(label: string, data?: Record<string, unknown>): void {
  if (!importVerboseEnabled()) return;
  if (data) console.warn(label, data);
  else console.warn(label);
}

/** Errores reales: siempre (pocos por importación exitosa). */
export function importServerError(label: string, data?: unknown): void {
  if (data !== undefined) console.error(label, data);
  else console.error(label);
}
