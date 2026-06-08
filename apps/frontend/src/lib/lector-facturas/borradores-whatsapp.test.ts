import { describe, expect, it } from 'vitest';

import { buildWhatsAppInvoiceTicketChatSummary } from '@/lib/whatsapp/sandbox';
import {
  fusionarResultadoJobEnDatosExtraidos,
  logIdDesdeResultadoFactura,
  requiereBorradorWebWhatsapp,
  urlBorradorLectorFactura,
} from './borradores-whatsapp';

const LOG_ID = '11111111-1111-4111-8111-111111111111';

describe('borradores WhatsApp', () => {
  it('requiere borrador web solo en needs_review', () => {
    expect(requiereBorradorWebWhatsapp({ status: 'needs_review' })).toBe(true);
    expect(requiereBorradorWebWhatsapp({ status: 'ready' })).toBe(false);
    expect(requiereBorradorWebWhatsapp({ status: 'applied' })).toBe(false);
  });

  it('extrae log_id del resultado del job', () => {
    expect(logIdDesdeResultadoFactura({ log_id: LOG_ID, items: [] })).toBe(LOG_ID);
    expect(logIdDesdeResultadoFactura({ log_id: 'no-uuid', items: [] })).toBeNull();
    expect(logIdDesdeResultadoFactura(null)).toBeNull();
  });

  it('fusiona items del job en datos_extraidos', () => {
    const merged = fusionarResultadoJobEnDatosExtraidos(
      { cabecera: { tipo_comprobante: 'factura_b' }, items: [{ indice: 0, descripcion: 'viejo' }] },
      {
        log_id: LOG_ID,
        items: [{ indice: 0, descripcion: 'nuevo', match: { producto_id: 'p1' } }],
        direccion: 'recibida',
      },
    );
    expect(merged.items).toEqual([
      { indice: 0, descripcion: 'nuevo', match: { producto_id: 'p1' } },
    ]);
    expect(merged.direccion).toBe('recibida');
  });

  it('incluye enlace de borrador en resumen WA cuando needs_review', () => {
    const url = 'https://app.example.com/lector-facturas?borrador=abc';
    const summary = buildWhatsAppInvoiceTicketChatSummary(
      {
        id: 'ticket-1',
        tenant_id: 't1',
        usuario_id: 'u1',
        actor_id: 'a1',
        from_wa_id: 'wa1',
        lector_factura_job_id: 'job-1',
        action_log_id: null,
        status: 'needs_review',
        summary: {
          proveedor_nombre: 'Arcor',
          proveedor_cuit: null,
          tipo_comprobante: 'factura_b',
          letra: 'B',
          punto_venta: 1,
          numero: 99,
          fecha: '2026-05-01',
          subtotal: 100,
          iva_21: 21,
          iva_10_5: null,
          iva_27: null,
          percepcion_iibb: null,
          percepcion_iva: null,
          impuesto_interno: null,
          otros_impuestos: null,
          total: 121,
          items_count: 1,
          productos_vinculados: 0,
          productos_pendientes: 1,
          productos_nuevos: 1,
          productos_para_revisar: 0,
          afecta_stock: true,
          afecta_cuenta_corriente: true,
          actualizar_costos: true,
          cambios_costos: [],
          advertencias: [],
          conflictos: [],
          bloqueantes: ['1 producto(s) pendientes de enlazar o revisar.'],
          impact_hash: 'hash123',
          can_apply: false,
        },
        pending_items: [
          {
            indice: 0,
            descripcion: 'Yerba',
            codigo: null,
            cantidad: 1,
            precio_unitario: 100,
            subtotal: 100,
            producto_id: null,
            producto_nombre: null,
            confidence: null,
            motivo: 'sin_producto',
          },
        ],
        chat_state: {},
        impact_hash: 'hash123',
        error_detail: null,
        created_at: '',
        updated_at: '',
        closed_at: null,
        applied_at: null,
      },
      null,
      url,
    );
    expect(summary).toContain(url);
    expect(summary).toContain('Para resolverlo en la app');
  });

  it('arma URL publica del borrador', () => {
    const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com';
    expect(urlBorradorLectorFactura(LOG_ID)).toBe(
      `https://app.example.com/lector-facturas?borrador=${LOG_ID}`,
    );
    if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
  });
});
