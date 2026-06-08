import { describe, expect, it } from 'vitest';

import {
  ajusteManualItemEnPayload,
  precioUnitarioConAjusteManualItem,
  textoAjusteManualItem,
} from '@/lib/pos/ajuste-linea-carrito';

describe('ajuste-linea-carrito POS', () => {
  it('aplica descuento manual porcentual sobre el precio efectivo del item', () => {
    expect(
      precioUnitarioConAjusteManualItem(4000, {
        descuento_manual_pct: 30,
      }),
    ).toBe(2800);
  });

  it('normaliza el payload para que el backend aplique el descuento por linea', () => {
    expect(
      ajusteManualItemEnPayload({
        descuento_manual_pct: 30,
        recargo_manual_pct: 0,
      }),
    ).toEqual({ descuento_manual_pct: 30 });
  });

  it('aplica recargo manual porcentual sobre el precio efectivo del item', () => {
    expect(
      precioUnitarioConAjusteManualItem(4000, {
        recargo_manual_pct: 10,
      }),
    ).toBe(4400);
  });

  it('normaliza el payload para que el backend aplique el recargo por linea', () => {
    expect(
      ajusteManualItemEnPayload({
        descuento_manual_pct: 0,
        recargo_manual_pct: 10,
      }),
    ).toEqual({ recargo_manual_pct: 10 });
  });

  it('genera una sublinea legible para ticket y POS', () => {
    expect(textoAjusteManualItem({ descuento_manual_pct: 30 })).toBe('Desc. item -30%');
    expect(textoAjusteManualItem({ recargo_manual_pct: 10 })).toBe('Rec. item +10%');
  });
});
