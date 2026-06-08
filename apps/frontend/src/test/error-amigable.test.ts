import { describe, expect, it } from 'vitest';

import { mensajeErrorBusquedaAmigable } from '@/lib/listados/error-amigable';

describe('mensajeErrorBusquedaAmigable', () => {
  it('convierte HTML 414 en mensaje legible solo con status 414 (no por el cuerpo)', () => {
    const sinStatus = mensajeErrorBusquedaAmigable(
      '<html><body><h1>414 Request-URI Too Large</h1></body></html>',
      'fallback',
    );
    expect(sinStatus).toBe('fallback');

    const conStatus = mensajeErrorBusquedaAmigable(
      '<html><body><h1>414 Request-URI Too Large</h1></body></html>',
      'fallback',
      { responseStatus: 414, terminoChars: 3 },
    );
    expect(conStatus).toMatch(/demasiado larga/i);
  });

  it('HTML con término muy largo sugiere acortar aunque el gateway no devuelva 414', () => {
    const out = mensajeErrorBusquedaAmigable('<html><body>error</body></html>', 'fallback', {
      terminoChars: 250,
      maxBusquedaChars: 200,
    });
    expect(out).toMatch(/demasiado larga/i);
  });

  it('deja mensajes de error simples sin tocar', () => {
    const out = mensajeErrorBusquedaAmigable('No autorizado', 'fallback');
    expect(out).toBe('No autorizado');
  });
});

