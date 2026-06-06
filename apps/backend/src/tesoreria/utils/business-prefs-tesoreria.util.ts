export type CajaInternaPrefs = {
  habilitado: boolean;
  alcance: 'tenant' | 'sucursal';
};

export type EffectiveBusinessPrefs = {
  cajaInterna: CajaInternaPrefs;
};

const DEFAULT_CAJA_INTERNA: CajaInternaPrefs = {
  habilitado: false,
  alcance: 'sucursal',
};

function readCajaInterna(raw: unknown): CajaInternaPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CAJA_INTERNA };
  const o = raw as Record<string, unknown>;
  const caja = o.cajaInterna;
  if (!caja || typeof caja !== 'object') return { ...DEFAULT_CAJA_INTERNA };
  const c = caja as Record<string, unknown>;
  return {
    habilitado: c.habilitado === true,
    alcance: c.alcance === 'tenant' ? 'tenant' : 'sucursal',
  };
}

export function effectiveBusinessPrefs(
  tenantPrefs: unknown | null,
  sucursalPrefs: unknown | null,
): EffectiveBusinessPrefs {
  const tenantCaja = readCajaInterna(tenantPrefs);
  const sucursalCaja = sucursalPrefs != null ? readCajaInterna(sucursalPrefs) : null;

  if (sucursalCaja) {
    return {
      cajaInterna: {
        habilitado: sucursalCaja.habilitado,
        alcance: sucursalCaja.alcance ?? tenantCaja.alcance,
      },
    };
  }

  return { cajaInterna: tenantCaja };
}

export function resolveCajaTesoreriaFilter(
  alcance: CajaInternaPrefs['alcance'],
  sucursalId: string | null,
): { sucursalId: null } | { sucursalId: string } {
  if (alcance === 'tenant') return { sucursalId: null };
  if (!sucursalId) {
    throw new Error('Se requiere sucursal para tesorer├¡a por sucursal.');
  }
  return { sucursalId };
}
