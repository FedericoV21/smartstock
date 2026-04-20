import { describe, expect, it } from 'vitest';

import { extraerPuntoDeVentaDesdeXml } from '@/lib/facturacion/arca/punto-venta';

describe('extraerPuntoDeVentaDesdeXml', () => {
  it('extrae el punto de venta desde XML SOAP', () => {
    const xml = `
      <soapenv:Envelope>
        <soapenv:Body>
          <ar:FECAESolicitar>
            <ar:FeCabReq>
              <ar:PtoVta>3</ar:PtoVta>
            </ar:FeCabReq>
          </ar:FECAESolicitar>
        </soapenv:Body>
      </soapenv:Envelope>
    `;

    expect(extraerPuntoDeVentaDesdeXml(xml)).toBe(3);
  });

  it('devuelve null si el XML no tiene punto de venta', () => {
    expect(extraerPuntoDeVentaDesdeXml('<xml></xml>')).toBeNull();
  });
});
