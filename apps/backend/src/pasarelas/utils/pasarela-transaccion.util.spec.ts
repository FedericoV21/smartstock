import { serializePasarelaTransaccion } from './pasarela-transaccion.util';

describe('pasarela-transaccion.util', () => {
  it('serializePasarelaTransaccion expone snake_case', () => {
    const row = {
      id: 'tx-1',
      tenantId: 't1',
      sucursalId: 's1',
      cajaId: 'c1',
      integracionId: 'i1',
      comprobanteId: 'comp1',
      proveedor: 'mercado_pago',
      canal: 'qr' as const,
      tipo: 'mp_qr',
      estado: 'pendiente',
      monto: '100.5',
      moneda: 'ARS',
      externalReference: 'comp1',
      externalIntentId: null,
      externalOrderId: 'ord-1',
      externalPaymentId: null,
      idempotencyKey: null,
      requestPayload: null,
      responsePayload: { ok: true },
      ultimoError: null,
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
      updatedAt: new Date('2026-01-01T12:01:00.000Z'),
    };
    expect(serializePasarelaTransaccion(row)).toMatchObject({
      id: 'tx-1',
      comprobante_id: 'comp1',
      estado: 'pendiente',
      monto: 100.5,
      external_order_id: 'ord-1',
    });
  });
});
