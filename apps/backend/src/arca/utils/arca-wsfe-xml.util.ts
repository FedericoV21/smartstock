import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';

export const AFIP_CBTE_NUMERO_MAX = 99_999_999;

export function buildFECompUltimoAutorizado(
  token: string,
  sign: string,
  cuit: string,
  puntoDeVenta: number,
  tipoComprobante: number,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Body>
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${puntoDeVenta}</ar:PtoVta>
      <ar:CbteTipo>${tipoComprobante}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function parsearCbteNroFeCompUltimoAutorizado(xml: string): number {
  const block =
    xml.match(/<FECompUltimoAutorizadoResult\b[^>]*>([\s\S]*?)<\/FECompUltimoAutorizadoResult>/i)?.[1] ??
    xml;
  const m =
    block.match(/<(?:[a-z]+:)?CbteNro[^>]*>\s*(\d+)\s*<\/(?:[a-z]+:)?CbteNro>/i) ??
    xml.match(/<CbteNro>\s*(\d+)\s*<\/CbteNro>/i);
  if (m?.[1]) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function buildFECompConsultar(
  token: string,
  sign: string,
  cuit: string,
  puntoDeVenta: number,
  tipoComprobante: number,
  cbteNro: number,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Body>
    <ar:FECompConsultar>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCompConsReq>
        <ar:CbteTipo>${tipoComprobante}</ar:CbteTipo>
        <ar:CbteNro>${cbteNro}</ar:CbteNro>
        <ar:PtoVta>${puntoDeVenta}</ar:PtoVta>
      </ar:FeCompConsReq>
    </ar:FECompConsultar>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function parsearCbteFchFeCompConsultar(xml: string): string | null {
  const block =
    xml.match(/<FECompConsultarResult\b[^>]*>([\s\S]*?)<\/FECompConsultarResult>/i)?.[1] ?? xml;
  const raw =
    block.match(/<(?:[a-z]+:)?CbteFch[^>]*>\s*(\d{8})\s*<\/(?:[a-z]+:)?CbteFch>/i)?.[1] ??
    block.match(/<CbteFch>\s*(\d{8})\s*<\/CbteFch>/i)?.[1];
  if (!raw) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function feCompConsultarIndicaComprobanteExistente(xml: string): boolean {
  const resultado = xml.match(/<(?:[a-z]+:)?Resultado[^>]*>\s*([AR])\s*<\/(?:[a-z]+:)?Resultado>/i)?.[1];
  return resultado?.toUpperCase() === 'A';
}

export function mapTipoComprobanteWsfe(tipo: TipoComprobante | string): number {
  const map: Record<string, number> = {
    factura_a: 1,
    factura_b: 6,
    factura_c: 11,
    nota_credito_a: 3,
    nota_credito_b: 8,
    nota_credito_c: 13,
  };
  const code = map[String(tipo)];
  if (!code) {
    throw new Error(`Tipo de comprobante no soportado por WSFE: ${tipo}`);
  }
  return code;
}
