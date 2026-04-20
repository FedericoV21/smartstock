export function buildLoginCmsRequest(cmsBase64: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export interface FECAEParams {
  token: string;
  sign: string;
  cuit: string;
  puntoDeVenta: number;
  tipoComprobante: number;
  concepto: number;
  numeroDesde: number;
  numeroHasta: number;
  fechaComprobante: string;
  tipoDocReceptor: number;
  nroDocReceptor: string;
  importeTotal: number;
  importeNeto: number;
  importeIVA: number;
  importeExento: number;
  alicuotaIVA: number;
  fechaServicioDesde?: string;
  fechaServicioHasta?: string;
  fechaVtoPago?: string;
}

export function buildFECAESolicitar(params: FECAEParams): string {
  const tieneServicio = params.concepto !== 1;
  const informarObjetoIva = !esComprobanteTipoC(params.tipoComprobante);

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${params.token}</ar:Token>
        <ar:Sign>${params.sign}</ar:Sign>
        <ar:Cuit>${params.cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${params.puntoDeVenta}</ar:PtoVta>
          <ar:CbteTipo>${params.tipoComprobante}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>${params.concepto}</ar:Concepto>
            <ar:DocTipo>${params.tipoDocReceptor}</ar:DocTipo>
            <ar:DocNro>${params.nroDocReceptor}</ar:DocNro>
            <ar:CbteDesde>${params.numeroDesde}</ar:CbteDesde>
            <ar:CbteHasta>${params.numeroHasta}</ar:CbteHasta>
            <ar:CbteFch>${params.fechaComprobante}</ar:CbteFch>
            <ar:ImpTotal>${params.importeTotal.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${params.importeNeto.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>${params.importeExento.toFixed(2)}</ar:ImpOpEx>
            <ar:ImpIVA>${params.importeIVA.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            ${tieneServicio ? `<ar:FchServDesde>${params.fechaServicioDesde}</ar:FchServDesde>
            <ar:FchServHasta>${params.fechaServicioHasta}</ar:FchServHasta>
            <ar:FchVtoPago>${params.fechaVtoPago}</ar:FchVtoPago>` : ''}
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            ${informarObjetoIva ? `<ar:Iva>
              <ar:AlicIva>
                <ar:Id>${mapAlicuotaIVAId(params.alicuotaIVA)}</ar:Id>
                <ar:BaseImp>${params.importeNeto.toFixed(2)}</ar:BaseImp>
                <ar:Importe>${params.importeIVA.toFixed(2)}</ar:Importe>
              </ar:AlicIva>
            </ar:Iva>` : ''}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildFECompUltimoAutorizado(
  token: string,
  sign: string,
  cuit: string,
  puntoDeVenta: number,
  tipoComprobante: number,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
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

function mapAlicuotaIVAId(porcentaje: number): number {
  const mapa: Record<number, number> = {
    0: 3,
    10.5: 4,
    21: 5,
    27: 6,
    5: 8,
    2.5: 9,
  };
  return mapa[porcentaje] ?? 5;
}

function esComprobanteTipoC(tipoComprobante: number): boolean {
  return tipoComprobante === 11 || tipoComprobante === 13;
}
