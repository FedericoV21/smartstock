export type EffectivePosPricingPrefs = {
  redondearPreciosCentenas: boolean;
  redondearMenores100ADecenas: boolean;
};

function mergePricingPrefs(
  target: EffectivePosPricingPrefs,
  raw: Record<string, unknown>,
): void {
  if (typeof raw.pvpRedondeoCentenasArriba === 'boolean') {
    target.redondearPreciosCentenas = raw.pvpRedondeoCentenasArriba;
  }
  if (typeof raw.pvpRedondeoMenores100ADecenas === 'boolean') {
    target.redondearMenores100ADecenas = raw.pvpRedondeoMenores100ADecenas;
  }
}

export function effectivePosPricingPrefs(
  tenantPrefs: unknown,
  sucursalPrefs: unknown | null,
): EffectivePosPricingPrefs {
  const out: EffectivePosPricingPrefs = {
    redondearPreciosCentenas: false,
    redondearMenores100ADecenas: false,
  };

  if (tenantPrefs && typeof tenantPrefs === 'object' && !Array.isArray(tenantPrefs)) {
    mergePricingPrefs(out, tenantPrefs as Record<string, unknown>);
  }
  if (sucursalPrefs && typeof sucursalPrefs === 'object' && !Array.isArray(sucursalPrefs)) {
    mergePricingPrefs(out, sucursalPrefs as Record<string, unknown>);
  }

  return out;
}
