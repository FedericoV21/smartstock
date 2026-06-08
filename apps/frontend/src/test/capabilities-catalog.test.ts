import { describe, expect, it } from 'vitest';

import {
  buildWhatsAppCapabilitiesCatalog,
  formatCapabilitiesForWhatsApp,
} from '@/lib/whatsapp/capabilities-catalog';

describe('buildWhatsAppCapabilitiesCatalog', () => {
  it('incluye consultas y acciones para operador con modulos activos', () => {
    const catalog = buildWhatsAppCapabilitiesCatalog({
      modules: { facturador_simple: true, stock: true, facturador_pos: true },
      rolWhatsapp: 'operador',
      channel: 'live',
    });
    const text = formatCapabilitiesForWhatsApp(catalog);
    expect(text).toContain('Consultas');
    expect(text).toContain('Acciones');
    expect(text).toContain('Facturas');
    expect(text).toContain('Notas de voz');
    expect(text).toContain('ventas hoy');
  });

  it('oculta acciones para readonly', () => {
    const catalog = buildWhatsAppCapabilitiesCatalog({
      modules: { facturador_simple: true, stock: true },
      rolWhatsapp: 'readonly',
      channel: 'live',
    });
    const ids = catalog.sections.map((s) => s.id);
    expect(ids).toContain('consultas');
    expect(ids).not.toContain('acciones');
    expect(ids).not.toContain('facturas');
  });
});
