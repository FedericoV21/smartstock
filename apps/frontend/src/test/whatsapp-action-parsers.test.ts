import { describe, expect, it } from 'vitest';

import {
  parseClienteCobranzaFacturaRequest,
  parseClientePaymentRequest,
  parseProveedorPaymentRequest,
  parseStockAdjustmentRequest,
} from '@/lib/whatsapp/action-parsers';

describe('whatsapp action parsers', () => {
  it('parsea pago proveedor con variantes', () => {
    expect(parseProveedorPaymentRequest('registrar pago proveedor Arcor 50000')).toEqual({
      proveedorNombre: 'Arcor',
      monto: 50000,
    });
    expect(parseProveedorPaymentRequest('pagar 12500 al proveedor Ginkgo')).toEqual({
      proveedorNombre: 'Ginkgo',
      monto: 12500,
    });
    expect(parseProveedorPaymentRequest('pague 10 lucas al proveedor Coca')).toEqual({
      proveedorNombre: 'Coca',
      monto: 10000,
    });
  });

  it('parsea cobro cliente con variantes', () => {
    expect(parseClientePaymentRequest('registrar cobro cliente Juan Perez 15000')).toEqual({
      clienteNombre: 'Juan Perez',
      monto: 15000,
    });
    expect(parseClientePaymentRequest('cobrar a cliente Kiosco Centro 2500')).toEqual({
      clienteNombre: 'Kiosco Centro',
      monto: 2500,
    });
  });

  it('parsea cobro por factura con referencia y ultima factura', () => {
    expect(parseClienteCobranzaFacturaRequest('cobrar factura 42 cliente Juan Perez 5000')).toEqual({
      clienteNombre: 'Juan Perez',
      monto: 5000,
      comprobanteRef: '42',
    });
    expect(parseClienteCobranzaFacturaRequest('cobrar ultima factura cliente Kiosco Centro 2500')).toEqual({
      clienteNombre: 'Kiosco Centro',
      monto: 2500,
      comprobanteRef: 'ultima',
    });
    expect(parseClienteCobranzaFacturaRequest('cobrar 15000 factura 0001-00000012 de cliente Maria Lopez')).toEqual({
      clienteNombre: 'Maria Lopez',
      monto: 15000,
      comprobanteRef: '0001-00000012',
    });
  });

  it('parsea ajuste de stock con signo', () => {
    expect(parseStockAdjustmentRequest('ajustar stock Yerba Playadito +10')).toEqual({
      productoNombre: 'Yerba Playadito',
      cantidad: 10,
      modo: 'delta',
    });
    expect(parseStockAdjustmentRequest('ajustar stock Coca 2.25L -3')).toEqual({
      productoNombre: 'Coca 2.25L',
      cantidad: -3,
      modo: 'delta',
    });
  });

  it('parsea dejar stock en cantidad objetivo', () => {
    expect(
      parseStockAdjustmentRequest('podrias cambiar el stock de Producto test 209 a 200'),
    ).toEqual({
      productoNombre: 'Producto test 209',
      cantidad: 200,
      modo: 'fijar',
    });
    expect(parseStockAdjustmentRequest('dejar stock Yerba Playadito en 50')).toEqual({
      productoNombre: 'Yerba Playadito',
      cantidad: 50,
      modo: 'fijar',
    });
  });
});
