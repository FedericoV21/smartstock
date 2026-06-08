import { describe, expect, it } from 'vitest';

import { validarDetalleMixto } from '@/lib/facturacion/emitir-comprobante';

describe('validarDetalleMixto', () => {
  it('acepta pagos mixtos sin cuenta corriente y la normaliza en cero', () => {
    const out = validarDetalleMixto(
      {
        efectivo: 400,
        debito: 600,
        credito: 0,
        transferencia: 0,
      },
      1000,
    );

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.detalle.cuenta_corriente).toBe(0);
    }
  });

  it('rechaza cuenta corriente invalida cuando viene informada', () => {
    const out = validarDetalleMixto(
      {
        efectivo: 400,
        debito: 600,
        credito: 0,
        transferencia: 0,
        cuenta_corriente: -1,
      },
      999,
    );

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain('cuenta_corriente');
    }
  });
});
