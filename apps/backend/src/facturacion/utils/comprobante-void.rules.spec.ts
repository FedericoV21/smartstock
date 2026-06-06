import {
  caeAfipFormatoValido,
  puedeAnularComprobanteInterno,
  validarMotivoAnulacion,
} from './comprobante-void.rules';

describe('comprobante-void.rules', () => {
  it('validates motivo length', () => {
    expect(validarMotivoAnulacion('abc').ok).toBe(false);
    expect(validarMotivoAnulacion('motivo ok').ok).toBe(true);
  });

  it('detects valid CAE format', () => {
    expect(caeAfipFormatoValido('70123456789012')).toBe(true);
    expect(caeAfipFormatoValido('123')).toBe(false);
  });

  it('allows void for emitido ticket without CAE', () => {
    const r = puedeAnularComprobanteInterno({
      estado: 'emitido',
      tipo: 'ticket',
      cae: null,
      tipoOperacion: 'venta',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects compra for internal void', () => {
    const r = puedeAnularComprobanteInterno({
      estado: 'emitido',
      tipo: 'factura_b',
      cae: null,
      tipoOperacion: 'compra',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects emitido factura with valid CAE', () => {
    const r = puedeAnularComprobanteInterno({
      estado: 'emitido',
      tipo: 'factura_b',
      cae: '70123456789012',
      tipoOperacion: 'venta',
    });
    expect(r.ok).toBe(false);
  });
});
