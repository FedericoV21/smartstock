import { describe, expect, it } from 'vitest';

import { normalizarRespuestaListadoProductos } from '@/lib/listados/productos-response';

describe('normalizarRespuestaListadoProductos', () => {
  it('mantiene éxito vacío como estado válido (no error)', () => {
    const out = normalizarRespuestaListadoProductos(true, {
      productos: [],
      total_paginas: 1,
      total: 0,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.productos).toEqual([]);
      expect(out.total_paginas).toBe(1);
      expect(out.total).toBe(0);
    }
  });

  it('devuelve error con mensaje del backend cuando status no es ok', () => {
    const out = normalizarRespuestaListadoProductos(false, {
      error: 'Timeout al consultar',
    });

    expect(out).toEqual({ ok: false, error: 'Timeout al consultar' });
  });

  it('devuelve error por payload inválido aunque status sea ok', () => {
    const out = normalizarRespuestaListadoProductos(true, null);

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/Respuesta inválida/);
    }
  });
});

