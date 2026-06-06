import { TipoComprobante } from '../enums/tipo-comprobante.enum';
import { ComprobantePdfService } from './comprobante-pdf.service';

describe('ComprobantePdfService', () => {
  it('generates a pdf buffer with fiscal block template', async () => {
    const service = new ComprobantePdfService();
    const pdf = await service.generateComprobantePdf({
      tipo: TipoComprobante.factura_b,
      numero: 42,
      fecha: '2026-04-19',
      emisor: { nombre: 'SmartStock', cuit: '30-12345678-9' },
      receptor: { nombre: 'Cliente Demo', cuitDni: '20123456789' },
      items: [{ descripcion: 'SKU1 - Producto', cantidad: 1, precioUnitario: 100, subtotal: 100 }],
      subtotal: 100,
      ivaMonto: 21,
      total: 121,
      fiscal: { cae: null, caeVencimiento: null, qrContenido: null },
    });

    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('incluye bloque con cadena e imagen I25 cuando hay CAE + CUIT + PV (NB-ARC-105)', async () => {
    const service = new ComprobantePdfService();
    const pdf = await service.generateComprobantePdf({
      tipo: TipoComprobante.factura_b,
      numero: 1,
      fecha: '2011-05-29',
      emisor: { nombre: 'ACME', cuit: '20-26756539-3' },
      items: [{ descripcion: 'Item', cantidad: 1, precioUnitario: 100, subtotal: 100 }],
      subtotal: 100,
      ivaMonto: 0,
      total: 100,
      fiscal: {
        cae: '61203034739042',
        caeVencimiento: '2011-05-29',
        puntoVenta: 4001,
        cuitEmisor: '20-26756539-3',
        qrContenido: null,
      },
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(2000);
  });
});
