/**
 * Preferencias por caja (`caja.prefs`). Cada caja pertenece a una sucursal; defaults OFF.
 */
export type CuentaCorrienteCajaPrefs = {
  /** Ticket térmico sin importes al emitir con cuenta corriente (requiere sucursal.permitirAjustesPorCaja). */
  ticketOcultarImportes: boolean;
};

export type CajaPrefs = {
  cuentaCorrienteCaja: CuentaCorrienteCajaPrefs;
};

export const DEFAULT_CUENTA_CORRIENTE_CAJA_PREFS: CuentaCorrienteCajaPrefs = {
  ticketOcultarImportes: false,
};

export const DEFAULT_CAJA_PREFS: CajaPrefs = {
  cuentaCorrienteCaja: DEFAULT_CUENTA_CORRIENTE_CAJA_PREFS,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeCuentaCorrienteCajaPrefs(raw: unknown): CuentaCorrienteCajaPrefs {
  const o = isPlainObject(raw) ? raw : {};
  return {
    ticketOcultarImportes:
      typeof o.ticketOcultarImportes === 'boolean'
        ? o.ticketOcultarImportes
        : DEFAULT_CUENTA_CORRIENTE_CAJA_PREFS.ticketOcultarImportes,
  };
}

export function normalizeCajaPrefs(raw: unknown | null | undefined): CajaPrefs {
  const root = isPlainObject(raw) ? raw : {};
  return {
    cuentaCorrienteCaja: normalizeCuentaCorrienteCajaPrefs(root.cuentaCorrienteCaja),
  };
}

export function mergeCajaPrefsPatch(
  current: CajaPrefs,
  patch: Partial<{ cuentaCorrienteCaja: Partial<CuentaCorrienteCajaPrefs> }>,
): CajaPrefs {
  const cc = patch.cuentaCorrienteCaja;
  if (!cc) return current;
  return normalizeCajaPrefs({
    cuentaCorrienteCaja: { ...current.cuentaCorrienteCaja, ...cc },
  });
}

export const CAJA_PREFS_PATCH_KEYS = ['cuentaCorrienteCaja'] as const;

export function isCajaPrefsPayload(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return CAJA_PREFS_PATCH_KEYS.some((k) => k in v);
}
