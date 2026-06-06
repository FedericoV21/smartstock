import { TipoComprobante } from '../enums/tipo-comprobante.enum';

/**
 * D├¡gito verificador m├│dulo 10 (AFIP / pyafipws `DigitoVerificadorModulo10`).
 * @see https://github.com/reingart/pyafipws/blob/main/pyi25.py
 */
export function digitoVerificadorModulo10(codigo: string): string {
  const s = codigo.trim();
  if (!s || !/^\d+$/.test(s)) {
    return '';
  }
  let etapa1 = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (i % 2 === 0) {
      etapa1 += parseInt(s[i]!, 10);
    }
  }
  const etapa2 = etapa1 * 3;
  let etapa3 = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (i % 2 === 1) {
      etapa3 += parseInt(s[i]!, 10);
    }
  }
  const etapa4 = etapa2 + etapa3;
  const resto = etapa4 - Math.floor(etapa4 / 10) * 10;
  let digito = 10 - resto;
  if (digito === 10) {
    digito = 0;
  }
  return String(digito);
}

export function normalizeCuitDigits(cuit: string): string {
  const d = cuit.replace(/\D/g, '');
  if (d.length !== 11) {
    throw new Error(`CUIT debe tener 11 d├¡gitos (recibido ${d.length})`);
  }
  return d;
}

/** Fecha `YYYY-MM-DD` o `YYYYMMDD` ÔåÆ `YYYYMMDD`. */
export function caeVencimientoToAfipYyyymmdd(fecha: string): string {
  const raw = fecha.trim().replace(/\D/g, '');
  if (raw.length === 8) {
    return raw;
  }
  if (raw.length === 10 && fecha.includes('-')) {
    return `${raw.slice(0, 4)}${raw.slice(4, 6)}${raw.slice(6, 8)}`;
  }
  throw new Error(`Fecha de vencimiento CAE inv├ílida: ${fecha}`);
}

/** C├│digo tipo comprobante WSFE (misma tabla que `ArcaWsfeService.mapTipoComprobante`). */
export function mapTipoComprobanteAfip(tipo: TipoComprobante): number | null {
  const map: Partial<Record<TipoComprobante, number>> = {
    [TipoComprobante.factura_a]: 1,
    [TipoComprobante.factura_b]: 6,
    [TipoComprobante.factura_c]: 11,
    [TipoComprobante.nota_credito_a]: 3,
    [TipoComprobante.nota_credito_b]: 8,
    [TipoComprobante.nota_credito_c]: 13,
  };
  const code = map[tipo];
  return code ?? null;
}

/**
 * Cadena num├®rica para c├│digo de barras Interleaved 2 of 5 (factura electr├│nica ARCA/AFIP).
 * Formato: CUIT(11) + tipo(2) + punto venta(4) + CAE(14) + vto CAE AAAAMMDD(8) + DV m├│dulo 10(1) ÔåÆ 40 d├¡gitos.
 */
export function buildCadenaCodigoBarrasAfip(params: {
  cuitEmisor: string;
  tipoCbteAfip: number;
  puntoVenta: number;
  cae: string;
  caeVencimiento: string;
}): string {
  const cuit = normalizeCuitDigits(params.cuitEmisor);
  const tipo = String(params.tipoCbteAfip).padStart(2, '0');
  const pv = String(params.puntoVenta).padStart(4, '0');
  const cae = params.cae.replace(/\D/g, '');
  if (cae.length !== 14) {
    throw new Error(`CAE debe tener 14 d├¡gitos (recibido ${cae.length})`);
  }
  const fv = caeVencimientoToAfipYyyymmdd(params.caeVencimiento);
  const base = `${cuit}${tipo}${pv}${cae}${fv}`;
  const dv = digitoVerificadorModulo10(base);
  if (!dv) {
    throw new Error('No se pudo calcular d├¡gito verificador del c├│digo de barras');
  }
  return `${base}${dv}`;
}
