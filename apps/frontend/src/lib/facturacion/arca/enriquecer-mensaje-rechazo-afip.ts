/**
 * Mensaje AFIP 10016 y variantes: número/fecha no coincide con el próximo a autorizar.
 * Se añade contexto para el operador (API JSON y UI), sin sustituir el texto ARCA.
 */

function textoNormalizado(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const MARCA_NEXUS = 'Revisá mismo punto de venta';

const GUIA_10016 =
  ` ${MARCA_NEXUS}, tipo de comprobante y ambiente ARCA (producción vs homologación). ` +
  'El siguiente número debe ser el consecutivo al último autorizado en AFIP para ese PtoVta y tipo, ' +
  'y la fecha de emisión no puede quedar por debajo de la correlatividad del último comprobante. ' +
  'Si también facturás en otro sistema o hubo emisiones manuales, la serie puede estar desfasada.';

export function enriquecerMensajeSiError10016Alineacion(mensaje: string, codigo?: string | null): string {
  const m = mensaje.trim();
  if (!m) return m;
  if (m.includes(MARCA_NEXUS)) return m;

  const c = String(codigo ?? '').trim();
  const t = textoNormalizado(m);

  const esAlineacion =
    c === '10016' ||
    t.includes('fecompultimoautorizado') ||
    (t.includes('proximo') && t.includes('autorizar') && (t.includes('numero') || t.includes('fecha'))) ||
    (t.includes('numero') && t.includes('fecha') && t.includes('corresponde') && t.includes('proximo'));

  if (!esAlineacion) return m;
  return `${m}${GUIA_10016}`;
}
