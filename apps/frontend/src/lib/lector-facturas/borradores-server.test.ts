import { describe, expect, it } from 'vitest';

import {
  datosExtraidosConPayloadBorrador,
  mapLectorFacturaBorradorListItem,
  metadataUpdateDesdePayload,
  payloadBorradorDesdeLog,
  validarPayloadBorradorLector,
} from './borradores-server';
import type { LectorFacturaBorradorPayloadV1 } from './borradores';

const LOG_ID = '11111111-1111-4111-8111-111111111111';
const PROVEEDOR_ID = '22222222-2222-4222-8222-222222222222';

function rowBase(overrides: Record<string, unknown> = {}) {
  return {
    id: LOG_ID,
    usuario_id: 'user-1',
    archivo_nombre: 'factura.pdf',
    archivo_mime: 'application/pdf',
    archivo_tamano: 1234,
    direccion: 'recibida',
    proveedor_id: null,
    cliente_id: null,
    created_at: '2026-05-16T10:00:00Z',
    updated_at: '2026-05-16T10:30:00Z',
    proveedor: null,
    cliente: null,
    usuario: { nombre: 'Nico', email: 'nico@example.com' },
    datos_extraidos: {
      direccion: 'recibida',
      cabecera: {
        tipo_comprobante: 'factura_b',
        letra: 'B',
        punto_venta: 1,
        numero: 99,
        fecha_emision: '2026-05-15',
        fecha_vencimiento: null,
        cae: null,
        cae_vencimiento: null,
      },
      emisor: {
        razon_social: 'Proveedor SA',
        cuit: '30-12345678-9',
        domicilio: '',
        condicion_iva: '',
        ingresos_brutos: '',
        inicio_actividades: '',
      },
      receptor: {
        razon_social: 'Mi negocio',
        cuit_dni: '20-11111111-1',
        domicilio: '',
        condicion_iva: '',
      },
      items: [
        {
          indice: 0,
          codigo: 'A1',
          descripcion: 'Producto A',
          cantidad: 2,
          unidad: 'unidad',
          precio_unitario: 100,
          bonificacion: null,
          subtotal: 200,
          iva_porcentaje: 21,
          producto_unidad: null,
          producto_unidad_compra: null,
          producto_contenido_unidad_compra: null,
          match: {
            producto_id: null,
            confidence: 0,
            metodo: 'sin_match',
            producto_nombre: null,
            requires_review: true,
          },
        },
      ],
      totales: {
        subtotal: 200,
        iva_21: 42,
        iva_10_5: null,
        iva_27: null,
        percepcion_iibb: 5,
        percepcion_iva: null,
        impuesto_interno: null,
        otros_impuestos: null,
        total: 247,
      },
      condicion_pago: '30 dias',
      observaciones: null,
      validacion: {
        totales_cuadran: true,
        advertencias: [],
        items_cuadran: true,
        suma_items: 200,
        referencia_items: 200,
        diferencia_items: 0,
      },
      multipagina: {},
    },
    ...overrides,
  };
}

describe('borradores del lector de facturas', () => {
  it('arma un borrador retomable desde una extraccion pendiente', () => {
    const payload = payloadBorradorDesdeLog(rowBase(), 21);

    expect(payload).toMatchObject({
      version: 1,
      paso: 'preview',
      archivoNombre: 'factura.pdf',
      previewPaso: 1,
      draft: {
        tipoOperacion: 'compra',
        incluirCrearProveedor: true,
        preciosItemsConIvaIncluido: true,
        percepcionIibb: '5.00',
      },
    });
    expect(payload.extraccion.log_id).toBe(LOG_ID);
    expect(payload.draft.items).toHaveLength(1);
  });

  it('guarda el payload editado dentro de datos_extraidos y actualiza metadata de compra', () => {
    const payload: LectorFacturaBorradorPayloadV1 = payloadBorradorDesdeLog(rowBase(), 21);
    payload.previewPaso = 2;
    payload.draft.proveedorElegidoId = PROVEEDOR_ID;
    payload.draft.incluirCrearProveedor = false;

    const datos = datosExtraidosConPayloadBorrador(rowBase().datos_extraidos, payload);
    const parsed = validarPayloadBorradorLector(datos.borrador_payload);
    const item = mapLectorFacturaBorradorListItem({
      ...rowBase(),
      proveedor_id: PROVEEDOR_ID,
      proveedor: { nombre: 'Proveedor SA' },
      datos_extraidos: datos,
    });

    expect(parsed.previewPaso).toBe(2);
    expect(item).toMatchObject({
      id: LOG_ID,
      guardado: true,
      total_items: 1,
      proveedor: { nombre: 'Proveedor SA' },
    });
    expect(metadataUpdateDesdePayload(payload)).toEqual({
      direccion: 'recibida',
      proveedor_id: PROVEEDOR_ID,
      cliente_id: null,
    });
  });
});
