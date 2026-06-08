export type CajaPrefs = {
  cuentaCorrienteCaja: {
    ticketOcultarImportes: boolean;
  };
};

const DEFAULT_CAJA_PREFS: CajaPrefs = {
  cuentaCorrienteCaja: { ticketOcultarImportes: false },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeCajaPrefs(raw: unknown | null | undefined): CajaPrefs {
  const root = isPlainObject(raw) ? raw : {};
  const cc = isPlainObject(root.cuentaCorrienteCaja) ? root.cuentaCorrienteCaja : {};
  return {
    cuentaCorrienteCaja: {
      ticketOcultarImportes:
        typeof cc.ticketOcultarImportes === 'boolean'
          ? cc.ticketOcultarImportes
          : DEFAULT_CAJA_PREFS.cuentaCorrienteCaja.ticketOcultarImportes,
    },
  };
}

export function isCajaPrefsPayload(v: unknown): boolean {
  return isPlainObject(v) && 'cuentaCorrienteCaja' in v;
}

export function mergeCajaPrefsPatch(
  current: CajaPrefs,
  patch: Partial<{ cuentaCorrienteCaja: Partial<CajaPrefs['cuentaCorrienteCaja']> }>,
): CajaPrefs {
  if (!patch.cuentaCorrienteCaja) return current;
  return normalizeCajaPrefs({
    cuentaCorrienteCaja: { ...current.cuentaCorrienteCaja, ...patch.cuentaCorrienteCaja },
  });
}
