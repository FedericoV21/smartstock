export const POS_PREFS_KEY = 'smartstock_pos_prefs';

export type PosPrefs = {
  sonidos: boolean;
  anchoTicket: '80mm' | '57mm';
  stockBloqueante: boolean;
  /** Cobro en ticket (comprobante no fiscal / negro). */
  aceptaTicket: boolean;
  /** Cobro en factura (blanco). */
  aceptaFactura: boolean;
  /** Valor inicial del selector en el POS (debe estar permitido). */
  comprobantePredeterminado: 'ticket' | 'factura';
};

const DEFAULT_POS_PREFS: PosPrefs = {
  sonidos: true,
  anchoTicket: '80mm',
  stockBloqueante: false,
  aceptaTicket: true,
  aceptaFactura: true,
  comprobantePredeterminado: 'ticket',
};

/** Asegura reglas coherentes (al menos un tipo permitido; predeterminado válido). */
export function normalizePosPrefs(raw: Partial<PosPrefs> | null | undefined): PosPrefs {
  const p: PosPrefs = { ...DEFAULT_POS_PREFS, ...raw };
  if (typeof p.aceptaTicket !== 'boolean') p.aceptaTicket = DEFAULT_POS_PREFS.aceptaTicket;
  if (typeof p.aceptaFactura !== 'boolean') p.aceptaFactura = DEFAULT_POS_PREFS.aceptaFactura;
  if (p.comprobantePredeterminado !== 'ticket' && p.comprobantePredeterminado !== 'factura') {
    p.comprobantePredeterminado = DEFAULT_POS_PREFS.comprobantePredeterminado;
  }
  if (!p.aceptaTicket && !p.aceptaFactura) {
    p.aceptaTicket = true;
    p.aceptaFactura = true;
  }
  if (p.comprobantePredeterminado === 'ticket' && !p.aceptaTicket) {
    p.comprobantePredeterminado = p.aceptaFactura ? 'factura' : 'ticket';
  }
  if (p.comprobantePredeterminado === 'factura' && !p.aceptaFactura) {
    p.comprobantePredeterminado = p.aceptaTicket ? 'ticket' : 'factura';
  }
  return p;
}

export function loadPosPrefs(): PosPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_POS_PREFS };
  try {
    const raw = localStorage.getItem(POS_PREFS_KEY);
    if (raw) return normalizePosPrefs(JSON.parse(raw) as Partial<PosPrefs>);
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_POS_PREFS };
}

export function savePosPrefs(prefs: PosPrefs) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(POS_PREFS_KEY, JSON.stringify(normalizePosPrefs(prefs)));
}

export function resolveTipoComprobanteInicial(prefs: PosPrefs): 'ticket' | 'factura' {
  const p = normalizePosPrefs(prefs);
  if (p.aceptaTicket && p.aceptaFactura) return p.comprobantePredeterminado;
  if (p.aceptaTicket) return 'ticket';
  return 'factura';
}

/** Ajusta el tipo elegido a lo permitido por preferencias (p. ej. carrito restaurado). */
export function clampTipoComprobante(t: 'ticket' | 'factura', prefs: PosPrefs): 'ticket' | 'factura' {
  const p = normalizePosPrefs(prefs);
  if (p.aceptaTicket && p.aceptaFactura) return t;
  if (p.aceptaTicket) return 'ticket';
  return 'factura';
}
