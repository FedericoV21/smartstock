import { describe, expect, it } from 'vitest';

import {
  determinarTipoFactura,
  resolverTipoFacturaVentaSolicitado,
  tiposFacturaVentaPermitidos,
} from './tipo-comprobante';

describe('determinarTipoFactura', () => {
  it('monotributista emisor siempre factura C', () => {
    expect(determinarTipoFactura('monotributista', 'responsable_inscripto')).toBe('factura_c');
    expect(determinarTipoFactura('monotributista', 'consumidor_final')).toBe('factura_c');
  });

  it('responsable inscripto: A a RI, B al resto', () => {
    expect(determinarTipoFactura('responsable_inscripto', 'responsable_inscripto')).toBe(
      'factura_a',
    );
    expect(determinarTipoFactura('responsable_inscripto', 'monotributista')).toBe('factura_b');
    expect(determinarTipoFactura('responsable_inscripto', 'consumidor_final')).toBe('factura_b');
  });
});

describe('resolverTipoFacturaVentaSolicitado', () => {
  it('acepta el tipo coincidente o omite tipo', () => {
    const r = resolverTipoFacturaVentaSolicitado(
      'factura_c',
      'monotributista',
      'responsable_inscripto',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tipo).toBe('factura_c');

    const r2 = resolverTipoFacturaVentaSolicitado(undefined, 'monotributista', 'consumidor_final');
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.tipo).toBe('factura_c');
  });

  it('rechaza A/B si el emisor es monotributista', () => {
    const r = resolverTipoFacturaVentaSolicitado(
      'factura_b',
      'monotributista',
      'consumidor_final',
    );
    expect(r.ok).toBe(false);
  });
});

describe('tiposFacturaVentaPermitidos', () => {
  it('devuelve un solo tipo coherente con determinarTipoFactura', () => {
    const t = tiposFacturaVentaPermitidos('responsable_inscripto', 'monotributista');
    expect(t).toEqual(['factura_b']);
  });
});
