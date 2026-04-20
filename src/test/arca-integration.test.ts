/**
 * Tests de integración ARCA contra el ambiente de homologación.
 *
 * Requieren certificado de homologación configurado en .env.local:
 *   ARCA_TEST_CERT_PEM=<contenido del certificado>
 *   ARCA_TEST_KEY_PEM=<contenido de la clave privada>
 *   ARCA_TEST_CUIT=<CUIT de homologación>
 *   ARCA_TEST_PTO_VENTA=<punto de venta>
 *   ARCA_ENCRYPTION_KEY=<clave de encriptación>
 *
 * Ejecutar: npm test -- --testPathPattern=arca-integration
 */
import { describe, expect, it } from 'vitest';

import { verificarVencimientoCertificado } from '@/lib/facturacion/arca/cert-check';
import { encriptarCampo, desencriptarCampo } from '@/lib/facturacion/arca/crypto';
import { getEndpoints } from '@/lib/facturacion/arca/endpoints';
import { mapTipoComprobante, mapTipoDocReceptor, CONCEPTO } from '@/lib/facturacion/arca/tipos';
import { obtenerTicketAcceso } from '@/lib/facturacion/arca/wsaa';
import { buildFECAESolicitar, buildFECompUltimoAutorizado, buildLoginCmsRequest } from '@/lib/facturacion/arca/xml-builder';

const HAS_ARCA_CREDS = !!(
  process.env.ARCA_TEST_CERT_PEM &&
  process.env.ARCA_TEST_KEY_PEM &&
  process.env.ARCA_TEST_CUIT
);

describe('ARCA - Unit tests (crypto, tipos, xml)', () => {
  it('encriptarCampo y desencriptarCampo son inversos', () => {
    const original = 'contenido secreto del certificado PEM';
    process.env.ARCA_ENCRYPTION_KEY = 'test-key-for-encryption-32chars';

    const encrypted = encriptarCampo(original);
    expect(encrypted).toContain(':');
    expect(encrypted).not.toBe(original);

    const decrypted = desencriptarCampo(encrypted);
    expect(decrypted).toBe(original);
  });

  it('getEndpoints retorna URLs correctas para homologación', () => {
    const ep = getEndpoints('homologacion');
    expect(ep.wsaa).toContain('wsaahomo');
    expect(ep.wsfe).toContain('wswhomo');
  });

  it('getEndpoints retorna URLs correctas para producción', () => {
    const ep = getEndpoints('produccion');
    expect(ep.wsaa).toBe('https://wsaa.afip.gob.ar/ws/services/LoginCms');
    expect(ep.wsfe).toBe('https://servicios1.afip.gov.ar/wsfev1/service.asmx');
  });

  it('mapTipoComprobante mapea correctamente', () => {
    expect(mapTipoComprobante('factura_a')).toBe(1);
    expect(mapTipoComprobante('factura_b')).toBe(6);
    expect(mapTipoComprobante('factura_c')).toBe(11);
    expect(mapTipoComprobante('nota_credito_a')).toBe(3);
    expect(mapTipoComprobante('nota_credito_b')).toBe(8);
    expect(mapTipoComprobante('nota_credito_c')).toBe(13);
  });

  it('mapTipoComprobante lanza error para tipo inválido', () => {
    expect(() => mapTipoComprobante('invalido')).toThrow('no soportado');
  });

  it('mapTipoDocReceptor identifica CUIT, DNI y sin identificar', () => {
    expect(mapTipoDocReceptor('20-12345678-9')).toEqual({ tipo: 80, nro: '20123456789' });
    expect(mapTipoDocReceptor('12345678')).toEqual({ tipo: 96, nro: '12345678' });
    expect(mapTipoDocReceptor(null)).toEqual({ tipo: 99, nro: '0' });
    expect(mapTipoDocReceptor('')).toEqual({ tipo: 99, nro: '0' });
  });

  it('buildLoginCmsRequest genera XML SOAP válido', () => {
    const xml = buildLoginCmsRequest('base64data==');
    expect(xml).toContain('loginCms');
    expect(xml).toContain('base64data==');
    expect(xml).toContain('soapenv:Envelope');
  });

  it('buildFECAESolicitar genera XML con todos los campos', () => {
    const xml = buildFECAESolicitar({
      token: 'tok',
      sign: 'sig',
      cuit: '20123456789',
      puntoDeVenta: 1,
      tipoComprobante: 6,
      concepto: CONCEPTO.PRODUCTOS,
      numeroDesde: 1,
      numeroHasta: 1,
      fechaComprobante: '20260416',
      tipoDocReceptor: 99,
      nroDocReceptor: '0',
      importeTotal: 121,
      importeNeto: 100,
      importeIVA: 21,
      importeExento: 0,
      alicuotaIVA: 21,
    });

    expect(xml).toContain('FECAESolicitar');
    expect(xml).toContain('<ar:Token>tok</ar:Token>');
    expect(xml).toContain('<ar:CbteTipo>6</ar:CbteTipo>');
    expect(xml).toContain('<ar:ImpTotal>121.00</ar:ImpTotal>');
    expect(xml).toContain('<ar:ImpNeto>100.00</ar:ImpNeto>');
    expect(xml).toContain('<ar:ImpIVA>21.00</ar:ImpIVA>');
    expect(xml).toContain('<ar:Iva>');
  });

  it('buildFECAESolicitar omite objeto IVA para Factura C', () => {
    const xml = buildFECAESolicitar({
      token: 'tok',
      sign: 'sig',
      cuit: '20123456789',
      puntoDeVenta: 3,
      tipoComprobante: 11,
      concepto: CONCEPTO.PRODUCTOS,
      numeroDesde: 2,
      numeroHasta: 2,
      fechaComprobante: '20260419',
      tipoDocReceptor: 99,
      nroDocReceptor: '0',
      importeTotal: 950,
      importeNeto: 950,
      importeIVA: 0,
      importeExento: 0,
      alicuotaIVA: 0,
    });

    expect(xml).toContain('<ar:ImpIVA>0.00</ar:ImpIVA>');
    expect(xml).not.toContain('<ar:Iva>');
  });

  it('buildFECompUltimoAutorizado genera XML correcto', () => {
    const xml = buildFECompUltimoAutorizado('tok', 'sig', '20123456789', 1, 6);
    expect(xml).toContain('FECompUltimoAutorizado');
    expect(xml).toContain('<ar:PtoVta>1</ar:PtoVta>');
    expect(xml).toContain('<ar:CbteTipo>6</ar:CbteTipo>');
  });
});

describe.skipIf(!HAS_ARCA_CREDS)('ARCA - Integración contra homologación', () => {
  const certPem = process.env.ARCA_TEST_CERT_PEM!;
  const keyPem = process.env.ARCA_TEST_KEY_PEM!;
  const cuit = process.env.ARCA_TEST_CUIT!;
  const ptoVenta = parseInt(process.env.ARCA_TEST_PTO_VENTA ?? '1');

  it('obtener ticket WSAA con certificado de homologación', async () => {
    const ticket = await obtenerTicketAcceso(certPem, keyPem, 'homologacion');

    expect(ticket.token).toBeTruthy();
    expect(ticket.sign).toBeTruthy();
    expect(ticket.expiracion).toBeInstanceOf(Date);
    expect(ticket.expiracion.getTime()).toBeGreaterThan(Date.now());
  }, 30000);

  it('consultar último comprobante con FECompUltimoAutorizado', async () => {
    const ticket = await obtenerTicketAcceso(certPem, keyPem, 'homologacion');
    const endpoints = getEndpoints('homologacion');

    const xml = buildFECompUltimoAutorizado(ticket.token, ticket.sign, cuit, ptoVenta, 6);

    const response = await fetch(endpoints.wsfe, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
      },
      body: xml,
    });

    expect(response.ok).toBe(true);
    const responseXml = await response.text();
    expect(responseXml).toContain('CbteNro');
  }, 30000);

  it('emitir Factura C y obtener CAE válido', async () => {
    const ticket = await obtenerTicketAcceso(certPem, keyPem, 'homologacion');
    const endpoints = getEndpoints('homologacion');

    // Consultar último número
    const ultimoXml = buildFECompUltimoAutorizado(ticket.token, ticket.sign, cuit, ptoVenta, 11);
    const ultimoRes = await fetch(endpoints.wsfe, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado' },
      body: ultimoXml,
    });
    const ultimoResXml = await ultimoRes.text();
    const ultimoNro = parseInt(ultimoResXml.match(/<CbteNro>(.*?)<\/CbteNro>/)?.[1] ?? '0');

    const soapBody = buildFECAESolicitar({
      token: ticket.token,
      sign: ticket.sign,
      cuit,
      puntoDeVenta: ptoVenta,
      tipoComprobante: 11,
      concepto: CONCEPTO.PRODUCTOS,
      numeroDesde: ultimoNro + 1,
      numeroHasta: ultimoNro + 1,
      fechaComprobante: new Date().toISOString().split('T')[0].replace(/-/g, ''),
      tipoDocReceptor: 99,
      nroDocReceptor: '0',
      importeTotal: 100,
      importeNeto: 100,
      importeIVA: 0,
      importeExento: 0,
      alicuotaIVA: 0,
    });

    const response = await fetch(endpoints.wsfe, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECAESolicitar' },
      body: soapBody,
    });

    expect(response.ok).toBe(true);
    const responseXml = await response.text();
    const resultado = responseXml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1];
    expect(resultado).toBe('A');
    expect(responseXml).toMatch(/<CAE>\d+<\/CAE>/);
  }, 60000);

  it('emitir Factura B y obtener CAE válido', async () => {
    const ticket = await obtenerTicketAcceso(certPem, keyPem, 'homologacion');
    const endpoints = getEndpoints('homologacion');

    const ultimoXml = buildFECompUltimoAutorizado(ticket.token, ticket.sign, cuit, ptoVenta, 6);
    const ultimoRes = await fetch(endpoints.wsfe, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado' },
      body: ultimoXml,
    });
    const ultimoResXml = await ultimoRes.text();
    const ultimoNro = parseInt(ultimoResXml.match(/<CbteNro>(.*?)<\/CbteNro>/)?.[1] ?? '0');

    const soapBody = buildFECAESolicitar({
      token: ticket.token,
      sign: ticket.sign,
      cuit,
      puntoDeVenta: ptoVenta,
      tipoComprobante: 6,
      concepto: CONCEPTO.PRODUCTOS,
      numeroDesde: ultimoNro + 1,
      numeroHasta: ultimoNro + 1,
      fechaComprobante: new Date().toISOString().split('T')[0].replace(/-/g, ''),
      tipoDocReceptor: 99,
      nroDocReceptor: '0',
      importeTotal: 121,
      importeNeto: 100,
      importeIVA: 21,
      importeExento: 0,
      alicuotaIVA: 21,
    });

    const response = await fetch(endpoints.wsfe, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECAESolicitar' },
      body: soapBody,
    });

    expect(response.ok).toBe(true);
    const responseXml = await response.text();
    const resultado = responseXml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1];
    expect(resultado).toBe('A');
    expect(responseXml).toMatch(/<CAE>\d+<\/CAE>/);
  }, 60000);

  it('emitir Nota de Crédito C y obtener CAE válido', async () => {
    const ticket = await obtenerTicketAcceso(certPem, keyPem, 'homologacion');
    const endpoints = getEndpoints('homologacion');

    const ultimoXml = buildFECompUltimoAutorizado(ticket.token, ticket.sign, cuit, ptoVenta, 13);
    const ultimoRes = await fetch(endpoints.wsfe, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado' },
      body: ultimoXml,
    });
    const ultimoResXml = await ultimoRes.text();
    const ultimoNro = parseInt(ultimoResXml.match(/<CbteNro>(.*?)<\/CbteNro>/)?.[1] ?? '0');

    const soapBody = buildFECAESolicitar({
      token: ticket.token,
      sign: ticket.sign,
      cuit,
      puntoDeVenta: ptoVenta,
      tipoComprobante: 13,
      concepto: CONCEPTO.PRODUCTOS,
      numeroDesde: ultimoNro + 1,
      numeroHasta: ultimoNro + 1,
      fechaComprobante: new Date().toISOString().split('T')[0].replace(/-/g, ''),
      tipoDocReceptor: 99,
      nroDocReceptor: '0',
      importeTotal: 50,
      importeNeto: 50,
      importeIVA: 0,
      importeExento: 0,
      alicuotaIVA: 0,
    });

    const response = await fetch(endpoints.wsfe, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECAESolicitar' },
      body: soapBody,
    });

    expect(response.ok).toBe(true);
    const responseXml = await response.text();
    const resultado = responseXml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1];
    expect(resultado).toBe('A');
  }, 60000);

  it('enviar datos inválidos y verificar rechazo de ARCA', async () => {
    const ticket = await obtenerTicketAcceso(certPem, keyPem, 'homologacion');
    const endpoints = getEndpoints('homologacion');

    const soapBody = buildFECAESolicitar({
      token: ticket.token,
      sign: ticket.sign,
      cuit,
      puntoDeVenta: ptoVenta,
      tipoComprobante: 1,
      concepto: CONCEPTO.PRODUCTOS,
      numeroDesde: 0,
      numeroHasta: 0,
      fechaComprobante: '20260416',
      tipoDocReceptor: 80,
      nroDocReceptor: '0',
      importeTotal: 0,
      importeNeto: 0,
      importeIVA: 0,
      importeExento: 0,
      alicuotaIVA: 21,
    });

    const response = await fetch(endpoints.wsfe, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECAESolicitar' },
      body: soapBody,
    });

    const responseXml = await response.text();
    const resultado = responseXml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1];
    expect(resultado).toBe('R');
  }, 30000);
});

describe('ARCA - cert-check', () => {
  it('verificarVencimientoCertificado retorna error para PEM inválido', () => {
    const result = verificarVencimientoCertificado('no-es-un-pem');
    expect(result.valido).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
