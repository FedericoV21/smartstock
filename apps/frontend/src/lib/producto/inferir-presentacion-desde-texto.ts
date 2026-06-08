import type { Database } from '@/types/database';

type UnidadMedida = Database['public']['Enums']['unidad_medida'];

const UNIDADES_COMPRA: UnidadMedida[] = ['caja', 'pack', 'unidad', 'kg', 'gramo', 'litro', 'ml', 'metro'];

export type ConfianzaPresentacion = 'alta' | 'media' | 'baja';

export type InferenciaPresentacion = {
  unidad_compra: UnidadMedida;
  /** Unidades de stock base (gramo, unidad, etc.) por 1 unidad_compra */
  contenido_unidad_compra: number;
  confianza: ConfianzaPresentacion;
  /** Patrón que disparó la inferencia (debug) */
  motivo: string;
  esCantidad: boolean;
};

/**
 * Heurísticas / regex sobre glosa de proveedor. No reemplaza columnas mapeadas; solo sugiere.
 * Falsos positivos posibles (marketing, packs 2x1).
 *
 * @param unidadStock — si se indica, filtra inferencias incompatibles (p. ej. peso vs unidad).
 */
export function inferirPresentacionDesdeTexto(
  texto: string,
  unidadStock?: UnidadMedida,
): InferenciaPresentacion | null {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (t.length < 2) return null;

  const lower = t.toLowerCase();

  const pesoOk = !unidadStock || unidadStock === 'gramo' || unidadStock === 'kg';
  const cantOk =
    !unidadStock ||
    unidadStock === 'unidad' ||
    unidadStock === 'caja' ||
    unidadStock === 'pack' ||
    unidadStock === 'litro' ||
    unidadStock === 'ml' ||
    unidadStock === 'metro';

  function contenidoDesdeKg(n: number): number {
    if (unidadStock === 'kg') return n;
    if (unidadStock === 'gramo' || unidadStock == null) return n * 1000;
    return n * 1000;
  }

  function contenidoDesdeGramos(n: number): number {
    if (unidadStock === 'kg') return n / 1000;
    return n;
  }

  /**
   * Patrones combinados tipo "12x400 gr", "6 x 1 kg", "4x250ml":
   * - Si el stock es por unidad, prioriza la cantidad de unidades por envase (12).
   * - Si el stock es por peso, convierte el total por envase (12 * 400gr = 4800gr).
   */
  const nxm = lower.match(
    /\b([0-9]{1,4})\s*[x×]\s*([0-9]{1,4}(?:[.,][0-9]+)?)\s*(kg|kgs|g|gr|grs|gramo|gramos|ml|cc|l|lt|lts|litro|litros|u\.?|und\.?|unid\.?|unidades?)?\b/,
  );
  if (nxm) {
    const n1 = parseInt(nxm[1]!, 10);
    const n2 = parseArgNumber(nxm[2]!);
    const suf = (nxm[3] ?? '').replace(/\./g, '');
    if (n1 > 1 && n2 != null && n2 > 0) {
      const esPeso = /^(kg|kgs|g|gr|grs|gramo|gramos)$/.test(suf);
      if (esPeso && pesoOk) {
        const porUnidad = suf.startsWith('kg') ? contenidoDesdeKg(n2) : contenidoDesdeGramos(n2);
        const total = porUnidad * n1;
        return {
          unidad_compra: 'caja',
          contenido_unidad_compra: total,
          confianza: 'alta',
          motivo: 'patrón NxM con peso',
          esCantidad: false,
        };
      }
      if (cantOk) {
        return {
          unidad_compra: 'caja',
          contenido_unidad_compra: n1,
          confianza: esPeso ? 'alta' : 'media',
          motivo: 'patrón NxM cantidad por envase',
          esCantidad: true,
        };
      }
    }
  }

  // Peso: "caja 20 kg", "pack(20 kg)", "x 5,5 kg", "bolsa 1.2kg"
  const packKgParen = lower.match(
    /(?:caja|bolsa|pack|bulto|blister|display)\s*\(\s*([0-9]+[.,]?[0-9]*)\s*kg\s*\)/,
  );
  if (packKgParen && pesoOk) {
    const n = parseArgNumber(packKgParen[1]!);
    if (n != null && n > 0) {
      const u: UnidadMedida = lower.includes('pack') ? 'pack' : 'caja';
      return {
        unidad_compra: u,
        contenido_unidad_compra: contenidoDesdeKg(n),
        confianza: 'alta',
        motivo: 'pack/caja (N kg)',
        esCantidad: false,
      };
    }
  }

  const kgM = lower.match(
    /(?:caja|bolsa|pack|bulto|q\.?b)\s+([0-9]+[.,]?[0-9]*)\s*kg\b/,
  );
  if (kgM && pesoOk) {
    const n = parseArgNumber(kgM[1]!);
    if (n != null && n > 0) {
      const u: UnidadMedida = lower.includes('pack') ? 'pack' : 'caja';
      return {
        unidad_compra: u,
        contenido_unidad_compra: contenidoDesdeKg(n),
        confianza: 'alta',
        motivo: 'caja/bolsa con kg',
        esCantidad: false,
      };
    }
  }
  const soloKg = lower.match(/\b([0-9]+[.,]?[0-9]*)\s*kg\b/);
  if (soloKg && pesoOk) {
    const n = parseArgNumber(soloKg[1]!);
    if (n != null && n > 0 && n <= 1000) {
      return {
        unidad_compra: 'caja',
        contenido_unidad_compra: contenidoDesdeKg(n),
        confianza: 'media',
        motivo: 'kg en texto',
        esCantidad: false,
      };
    }
  }

  // Gramos sueltos: "500 g", "200gr"
  const gM = lower.match(/\b([0-9]+)\s*g(?:r|ramos?)?\b/);
  if (gM && !lower.includes('kg') && pesoOk && unidadStock !== 'kg') {
    const g = parseInt(gM[1]!, 10);
    if (g > 0 && g >= 10) {
      return {
        unidad_compra: 'caja',
        contenido_unidad_compra: g,
        confianza: 'media',
        motivo: 'gramos explícitos',
        esCantidad: false,
      };
    }
  }

  if (!cantOk) return null;

  // Paréntesis: "caja(500 unidades)", "pack (12)", "caja (500 u)" (típico en Excel)
  const cajaParen = lower.match(
    /(?:caja|pack|bulto|blister|display)\s*\(\s*([0-9]+)\s*(?:u\.?|und\.?|unid\.?|unidades?)?\s*\)/,
  );
  if (cajaParen) {
    const n = parseInt(cajaParen[1]!, 10);
    if (n > 0) {
      const u: UnidadMedida = lower.includes('pack') ? 'pack' : 'caja';
      return {
        unidad_compra: u,
        contenido_unidad_compra: n,
        confianza: 'alta',
        motivo: 'caja/pack (N) con paréntesis',
        esCantidad: true,
      };
    }
  }

  // Unidades: "caja x 500", "x500", "500 u.", "500 unidades", "pack 12"
  const cajaNum = lower.match(
    /(?:caja|pack|bulto|blister|display)\s*(?:de|x)?\s*([0-9]+)\s*(?:u\.?|und|unid|unidades)?\b/,
  );
  if (cajaNum) {
    const n = parseInt(cajaNum[1]!, 10);
    if (n > 0) {
      const u: UnidadMedida = lower.includes('pack') ? 'pack' : 'caja';
      return {
        unidad_compra: u,
        contenido_unidad_compra: n,
        confianza: 'alta',
        motivo: 'caja/pack con cantidad',
        esCantidad: true,
      };
    }
  }

  // "x 300", "x 300 u", "x300u" (sin espacio antes de u); evita "2x300" promo (sin \b antes de x)
  const xNumLoose =
    lower.match(
      /\bx\s*([0-9]+)(?!\s*(?:g|gr|grs|gramo|gramos|kg|kgs|ml|cc|l|lt|lts|litro|litros)\b)\s*(?:u\.?|und\.?|unid\.?|unidades?)?\b/,
    ) ??
    lower.match(/\bx([0-9]{2,5})u\b/);
  if (xNumLoose) {
    const n = parseInt(xNumLoose[1]!, 10);
    if (n > 10 && n < 100_000) {
      return {
        unidad_compra: 'caja',
        contenido_unidad_compra: n,
        confianza: 'media',
        motivo: 'patrón x N / xNu',
        esCantidad: true,
      };
    }
  }

  const uNum = lower.match(/\b([0-9]+)\s*(?:u\.?|und\.?|unid)\b/);
  if (uNum) {
    const n = parseInt(uNum[1]!, 10);
    if (n > 1 && n < 100_000) {
      return {
        unidad_compra: 'caja',
        contenido_unidad_compra: n,
        confianza: 'baja',
        motivo: 'N u. / unid',
        esCantidad: true,
      };
    }
  }

  return null;
}

/**
 * Solo envases por peso (x500gr, x 0,5 kg, bolsa 500 g, caja 20 kg).
 * Al forzar importación pesable en kg, el costo del archivo suele ser por ese envase.
 */
export function inferirPresentacionPesoEnvaseDesdeTexto(
  texto: string,
  unidadStock: 'kg' | 'gramo' = 'kg',
): InferenciaPresentacion | null {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (t.length < 2) return null;

  const lower = t.toLowerCase().replace(/\u00d7/g, 'x');

  function contenidoDesdeKg(n: number): number {
    if (unidadStock === 'kg') return n;
    return n * 1000;
  }

  function contenidoDesdeGramos(n: number): number {
    if (unidadStock === 'kg') return n / 1000;
    return n;
  }

  function envasePeso(contenido: number, motivo: string, confianza: ConfianzaPresentacion): InferenciaPresentacion | null {
    if (!(contenido > 0) || contenido > 1000) return null;
    return {
      unidad_compra: 'unidad',
      contenido_unidad_compra: contenido,
      confianza,
      motivo,
      esCantidad: false,
    };
  }

  const xPeso = lower.match(/\bx\s*([0-9]+(?:[.,][0-9]+)?)\s*(kg|kgs|g|gr|grs|gramo|gramos)\b/);
  if (xPeso) {
    const n = parseArgNumber(xPeso[1]!);
    const suf = xPeso[2]!;
    if (n != null && n > 0) {
      const contenido = suf.startsWith('kg') ? contenidoDesdeKg(n) : contenidoDesdeGramos(n);
      const hit = envasePeso(contenido, 'x N peso en nombre', 'alta');
      if (hit) return hit;
    }
  }

  const nxm = lower.match(
    /\b([0-9]{1,4})\s*x\s*([0-9]{1,4}(?:[.,][0-9]+)?)\s*(kg|kgs|g|gr|grs|gramo|gramos)\b/,
  );
  if (nxm) {
    const n1 = parseInt(nxm[1]!, 10);
    const n2 = parseArgNumber(nxm[2]!);
    const suf = nxm[3]!;
    if (n1 > 1 && n2 != null && n2 > 0) {
      const porUnidad = suf.startsWith('kg') ? contenidoDesdeKg(n2) : contenidoDesdeGramos(n2);
      const hit = envasePeso(porUnidad * n1, 'patrón NxM con peso', 'alta');
      if (hit) return hit;
    }
  }

  const packKgParen = lower.match(
    /(?:caja|bolsa|pack|bulto|blister|display)\s*\(\s*([0-9]+[.,]?[0-9]*)\s*kg\s*\)/,
  );
  if (packKgParen) {
    const n = parseArgNumber(packKgParen[1]!);
    if (n != null && n > 0) {
      const u: UnidadMedida = lower.includes('pack') ? 'pack' : lower.includes('bolsa') ? 'unidad' : 'caja';
      const contenido = contenidoDesdeKg(n);
      if (contenido > 0 && contenido <= 1000) {
        return {
          unidad_compra: u,
          contenido_unidad_compra: contenido,
          confianza: 'alta',
          motivo: 'pack/caja (N kg)',
          esCantidad: false,
        };
      }
    }
  }

  const kgM = lower.match(/(?:caja|bolsa|pack|bulto|q\.?b)\s+([0-9]+[.,]?[0-9]*)\s*kg\b/);
  if (kgM) {
    const n = parseArgNumber(kgM[1]!);
    if (n != null && n > 0) {
      const u: UnidadMedida = lower.includes('pack') ? 'pack' : lower.includes('bolsa') ? 'unidad' : 'caja';
      const contenido = contenidoDesdeKg(n);
      if (contenido > 0 && contenido <= 1000) {
        return {
          unidad_compra: u,
          contenido_unidad_compra: contenido,
          confianza: 'alta',
          motivo: 'caja/bolsa con kg',
          esCantidad: false,
        };
      }
    }
  }

  const soloKg = lower.match(/\b([0-9]+[.,]?[0-9]*)\s*kg\b/);
  if (soloKg) {
    const n = parseArgNumber(soloKg[1]!);
    if (n != null && n > 0 && n <= 1000) {
      const hit = envasePeso(contenidoDesdeKg(n), 'kg en texto', 'media');
      if (hit) return hit;
    }
  }

  const gM = lower.match(/\b([0-9]+)\s*g(?:r|ramos?)?\b/);
  if (gM && !lower.includes('kg')) {
    const g = parseInt(gM[1]!, 10);
    if (g >= 10) {
      const hit = envasePeso(contenidoDesdeGramos(g), 'gramos explícitos', 'media');
      if (hit) return hit;
    }
  }

  return null;
}

function parseArgNumber(s: string): number | null {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function esUnidadCompraValida(u: string | null | undefined): u is UnidadMedida {
  if (!u) return false;
  const v = u.toLowerCase().trim() as UnidadMedida;
  return UNIDADES_COMPRA.includes(v);
}
